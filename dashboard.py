import streamlit as st
import pandas as pd
from sqlalchemy import create_engine
import html
from diff_match_patch import diff_match_patch

from config import get_settings

# --- DATABASE CONFIG ---
settings = get_settings()
engine = create_engine(settings.sync_database_url)

st.set_page_config(page_title="SentinelQAPortal Pro", layout="wide", page_icon="👁️")

# --- CUSTOM CSS FOR GITHUB-LIKE UI ---
st.markdown("""
<style>
    .reportview-container { background: #0d1117; }
    .stMetric { background-color: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; }
    .event-card {
        background-color: #161b22;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 20px;
        margin-bottom: 20px;
    }
    .badge {
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
        color: white;
    }
    .badge-created { background-color: #238636; }
    .badge-updated { background-color: #d29922; }
    .badge-moved { background-color: #8957e5; }
    .badge-archived { background-color: #f85149; }
    
    .diff-container {
        background-color: #0d1117;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 10px;
        font-family: monospace;
        white-space: pre-wrap;
    }
    .diff-add { background-color: #2ea04326; color: #3fb950; text-decoration: none; }
    .diff-del { background-color: #f8514926; color: #f85149; text-decoration: line-through; }
    .path-text { color: #8b949e; font-size: 13px; }
    .actor-text { color: #58a6ff; font-weight: bold; }
</style>
""", unsafe_allow_html=True)

# --- UTILITY FUNCTIONS ---
def generate_html_diff(old_text, new_text):
    if not old_text: old_text = ""
    if not new_text: new_text = ""
    dmp = diff_match_patch()
    diffs = dmp.diff_main(str(old_text), str(new_text))
    dmp.diff_cleanupEfficiency(diffs)
    
    html = ""
    for (flag, data) in diffs:
        safe_data = html_escape(data)
        if flag == 0: html += safe_data
        elif flag == 1: html += f'<span class="diff-add">{safe_data}</span>'
        elif flag == -1: html += f'<span class="diff-del">{safe_data}</span>'
    return html

def html_escape(value):
    return html.escape("" if value is None else str(value), quote=True)

@st.cache_data(ttl=30)
def load_audit_data():
    query = "SELECT * FROM audit_log ORDER BY detected_at DESC LIMIT 100"
    df = pd.read_sql(query, engine)
    return df

# --- UI HEADER ---
st.title("📂 Zephyr Governance Audit")
st.caption("Tracking changes across CEFI > Trading > Futures")

# Sidebar
st.sidebar.image("https://upload.wikimedia.org/wikipedia/commons/e/e9/Jenkins_logo.svg", width=50) # Placeholder for your org logo
st.sidebar.header("Filter Activity")
action_filter = st.sidebar.multiselect("Action Type", ["CREATED", "UPDATED", "MOVED", "ARCHIVED"], default=["CREATED", "UPDATED", "MOVED", "ARCHIVED"])
search = st.sidebar.text_input("Search Key or Folder", "")

df = load_audit_data()
if action_filter:
    df = df[df['action'].isin(action_filter)]
if search:
    safe_search = search.strip()
    df = df[
        df['zephyr_key'].fillna("").str.contains(safe_search, case=False, regex=False)
        | df['folder_after'].fillna("").str.contains(safe_search, case=False, regex=False)
    ]

# Stats Summary
c1, c2, c3, c4 = st.columns(4)
c1.metric("Total Events", len(df))
c2.metric("New Cases", len(df[df['action']=='CREATED']))
c3.metric("Updates", len(df[df['action']=='UPDATED']))
c4.metric("Moves", len(df[df['action']=='MOVED']))

st.write("---")

# --- EVENT FEED (GITHUB STYLE) ---
for _, row in df.iterrows():
    with st.container():
        # Action color logic
        action_value = str(row['action'])
        badge_class = f"badge-{action_value.lower()}" if action_value in {"CREATED", "UPDATED", "MOVED", "ARCHIVED"} else "badge-updated"
        action = html_escape(action_value)
        zephyr_key = html_escape(row['zephyr_key'])
        detected_at = html_escape(row['detected_at'].strftime('%Y-%m-%d %H:%M'))
        actor_name = html_escape(row['actor_name'] if row['actor_name'] else 'Unknown User')
        folder_after = html_escape(row['folder_after'] if row['folder_after'] else 'Root')
        
        # UI Card Start
        st.markdown(f"""
        <div class="event-card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span class="badge {badge_class}">{action}</span>
                    <b style="font-size: 18px; margin-left: 10px;">{zephyr_key}</b>
                    <span style="color: #8b949e; margin-left: 10px;">{detected_at}</span>
                </div>
                <div class="actor-text">👤 {actor_name}</div>
            </div>
            <div class="path-text" style="margin-top: 8px;">
                📍 Folder: {folder_after}
            </div>
        """, unsafe_allow_html=True)

        # Content for UPDATED items (The Diff)
        if row['action'] == "UPDATED":
            st.markdown("**Changes in this version:**")
            diff_before = row['diff_before'] if row['diff_before'] else {}
            diff_after = row['diff_after'] if row['diff_after'] else {}
            
            # Identify what specifically changed (e.g., Name or Objective)
            for field in ['name', 'objective', 'precondition']:
                old_val = diff_before.get(field)
                new_val = diff_after.get(field)
                
                if old_val != new_val:
                    st.markdown(f"**Field: `{html_escape(field.capitalize())}`**")
                    diff_html = generate_html_diff(old_val, new_val)
                    st.markdown(f'<div class="diff-container">{diff_html}</div>', unsafe_allow_html=True)

        # Content for MOVED items
        elif row['action'] == "MOVED":
            st.markdown(f"""
            <div style="margin-top: 15px;">
                <span class="diff-del" style="padding: 5px;">{html_escape(row['folder_before'])}</span>
                <span style="color: white;"> ⮕ </span> 
                <span class="diff-add" style="padding: 5px;">{html_escape(row['folder_after'])}</span>
            </div>
            """, unsafe_allow_html=True)

        # Content for CREATED items
        elif row['action'] == "CREATED":
            case_name = row['diff_after'].get('name', 'Untitled Case')
            st.markdown(f"**Initial Content:**\n`{case_name}`")
            with st.expander("View Initial Snapshot"):
                st.json(row['diff_after'])

        st.markdown("</div>", unsafe_allow_html=True)
