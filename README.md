# Sentinel QA

Tracks Zephyr Scale test-case changes for a configured project folder scope and exposes the audit stream through FastAPI plus a React dashboard.

## Setup

1.  **Create local environment files:**

    ```bash
    cp .env.example .env
    cp ui/.env.example ui/.env.local
    ```

2.  **Configure Environment:**
    Fill in `ZEPHYR_API_TOKEN`, `ZEPHYR_PROJECT_KEY`, `ZEPHYR_PARENT_FOLDER_ID`, and a strong `AUDIT_API_KEY`. Use the same API key in `ui/.env.local` as `VITE_AUDIT_API_KEY`.

3.  **Install Backend Dependencies:**
    This sets up a virtual environment and installs the required Python packages.

    ```bash
    python -m venv venv
    ./venv/bin/pip install -r requirements.txt
    ```

## Running the Application Locally

### Method 1: The Simple Way (Recommended)

To start both the backend FastAPI server and frontend React/Vite server concurrently (along with the Docker database), simply run the startup script from the root directory:

```bash
./start.sh
```

This script will automatically:
1. Verify virtual environment existence.
2. Spin up the PostgreSQL database in Docker.
3. Check if ports `8000` or `5173` are in use and clear them to prevent serving outdated assets.
4. Launch uvicorn and Vite.
5. Exit both cleanly when you press `Ctrl+C`.

---

### Method 2: Manual Startup (Using Multiple Terminals)

If you prefer running the servers in separate terminal windows:

#### Terminal 1: Start the Backend Services

1. **Start the Database:**
   ```bash
   docker compose up -d db
   ```

2. **Run the Initial Data Sync:**
   ```bash
   ./venv/bin/python poller.py
   ```

3. **Start the Backend API Server:**
   This starts the FastAPI server on `http://localhost:8000`.
   ```bash
   ./venv/bin/uvicorn app.main:app --reload --port 8000
   ```

#### Terminal 2: Start the Frontend UI

1. **Navigate to the UI directory and install dependencies (if not already done):**
   ```bash
   cd ui && npm install
   ```

2. **Start the React Development Server:**
   This launches the UI on `http://localhost:5173`.
   ```bash
   npm run dev
   ```

> [!IMPORTANT]
> If port `5173` is already in use by a background Node/Vite process, Vite will automatically fall back to `http://localhost:5174/`. 
> Always make sure to stop previous instances (using `kill -9 $(lsof -t -i:5173)` or running `./start.sh` which checks this automatically) to prevent loading outdated code.

## Operational Notes

-   **Backfilling Modifier Names**: If you see "Unknown Modifier" in the UI, run the backfill command. This requires `TM4J_JWT`, `TM4J_BASE_URL`, and `TM4J_JIRA_PROJECT_ID` to be set in your `.env` file.
    ```bash
    ./venv/bin/python poller.py --backfill-actors
    ```
-   Database tables are automatically created on first API startup or poller run.
-   The poller records `ARCHIVED` when a previously indexed case disappears from the configured folder scope. That can mean deletion, archive, permission loss, or move outside scope.
-   Status transitions into values listed in `ARCHIVE_STATUS_NAMES` are also logged as `ARCHIVED`.
-   `raw_snapshot` stores the full Zephyr payload plus fetched `testSteps`. Hashing and `changed_fields` are still computed from meaningful fields only.
-   The API requires `X-API-Key` or `Authorization: Bearer <key>` for all data endpoints.
-   Browser-side `VITE_AUDIT_API_KEY` is not sufficient for team hosting. Use an authenticated reverse proxy, VPN, or SSO boundary. See `deploy/nginx.conf.example`.
-   `alert_worker.py` scans unalerted audit rows and posts a Slack batch using exponential backoff before marking rows as alerted.
-   Generated folders such as `venv`, `ui/node_modules`, `ui/dist`, `.idea`, and local env files are ignored by the root `.gitignore`.

## Suggested Cron

```bash
0 * * * * cd /Users/maniteja/zephyr-audit-system && ./venv/bin/python poller.py >> poller.log 2>&1
5 * * * * cd /Users/maniteja/zephyr-audit-system && ./venv/bin/python alert_worker.py >> alert_worker.log 2>&1
```


This document serves as the complete technical specification, architectural blueprint, and operational documentation for the **Sentinel QA System** designed and implemented for your organization.

---

## 1. Project Overview & Problem Statement

### 1.1 Context
In modern software engineering organizations, test cases represent the ultimate "source of truth" for quality assurance and product health. Your organization uses Atlassian Jira integrated with SmartBear Zephyr Scale (Cloud) to manage test suites across multiple cross-functional teams ("tribes").

The primary targeted scope of governance is the core test repository located under the logical path:
`All Test Cases ⮕ CEFI (13,093) ⮕ Trading (7,282) ⮕ Futures (2,740)`.

### 1.2 The Problem
Zephyr Scale is highly effective for individual test execution and management, but it presents several governance challenges when scaled across multiple tribes modifying the same files:
*   **Lack of Proactive Visibility:** No centralized system alerts teams when a test case is added, updated, or removed from a critical path.
*   **Missing Historical Context:** While individual test case history exists, there is no global audit feed showing *who* changed *what field* and *when* across the entire tribe's scope.
*   **Untracked Movements:** When a testcase is moved from one functional folder to another (or moved to a deprecated archive folder), the context of "from where" and "to where" is lost.
*   **API Noise and False Positives:** Standard REST API responses contain highly volatile metadata (such as background Jira sync timestamps or modified link structures) that trigger false "update" events even when no human edited the test case content.
*   **API Pagination Limits:** The official Zephyr Scale Cloud API limits flat queries, making it difficult for teams to browse, search, and audit the entire 2,800+ test suite baseline from a single interface.

---

## 2. System Architecture

The system is designed as a decoupled, three-tier middleware architecture to ensure high performance, isolation from Jira API limits, and a highly responsive user experience.

```
┌──────────────────────────────┐
│      Zephyr Scale API        │
└──────────────┬───────────────┘
               │ (HTTPS REST API / JSON)
        ┌──────▼────────────────────────┐
        │   Asynchronous Poller Engine  │ (Python + HTTPX)
        └──────┬─────────────────┬──────┘
               │ write           │ write
        ┌──────▼───────┐   ┌─────▼────────┐
        │TestCaseState │   │  Audit Log   │ (PostgreSQL Engine)
        └──────┬───────┘   └─────┬────────┘
               │ read            │ read
        ┌──────▼─────────────────▼──────┐
        │      FastAPI Backend API      │ (Asynchronous REST JSON)
        └──────────────┬────────────────┘
                       │ (CORS Allowed / JSON)
        ┌──────────────▼────────────────┐
        │     React / Vite Frontend     │ (Tailwind CSS + Lucide)
        └───────────────────────────────┘
```

### 2.1 Component Mapping
*   **Data Collector (Poller Engine):** An isolated Python background script that runs recursively. It queries the Zephyr Scale API folder-by-folder, hashes only the *meaningful* content fields to prevent false-positive change detection, compares states, and writes clean diffs to the database.
*   **Database (Postgres State Store):** Acts as the localized "State Engine." By storing a snapshot of the last known state, the system can compute a "before" and "after" comparison natively without spamming the Zephyr API.
*   **Backend API (FastAPI):** A high-performance, asynchronous REST layer that exposes your database tables as JSON endpoints. It serves statistics, recent logs, and the complete flat test case repository.
*   **Frontend Client (React + Vite):** A single-page application (SPA) styled with a high-density, dark-theme UI. It processes raw JSON snapshots on the fly to render clean, readable diff tables and searchable lists.

---

## 3. Technology Stack & Frameworks

| Layer | Technology | Version / Choice | Reason for Selection |
| :--- | :--- | :--- | :--- |
| **Database** | PostgreSQL | `15-alpine` | JSONB support for flexible snapshots, row-level transactional safety, reliable indexing of audit logs. |
| **Backend ORM** | SQLAlchemy | `2.0+ (with asyncpg)` | Native Python async support, powerful query compilation, preventing blocking I/O during heavy polling. |
| **Scheduler/Driver** | Python asyncio | `3.14 (Venv isolated)` | Handles concurrent network operations and sub-process execution natively. |
| **HTTP Client** | HTTPX | `AsyncClient` | Modern async HTTP client with strict timeout controls for reliable REST calls. |
| **API Framework** | FastAPI | `0.110+` | Automatic OpenAPI/Swagger generation, lightning-fast ASGI execution, native CORS middleware support. |
| **Frontend Tooling** | Vite | `8.0+` | Extremely fast HMR (Hot Module Replacement), optimized asset bundling. |
| **UI Library** | React | `18+` | Declarative, component-based structure for real-time state management. |
| **Styling** | Tailwind CSS | `3.4` | High-density layout control, highly utility-first configuration for cohesive "GitHub-dark" design tokens. |
| **Icons** | Lucide React | `0.300+` | Clean, responsive SVG vector icons styled natively via Tailwind classes. |

---

## 4. Backend Design & Database Schema

The database utilizes three highly indexed tables optimized for fast writes (from the poller) and flexible reads (from the API).

```
  test_case_state                 audit_log                       folder_map
  ┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐
  │ id (UUID, PK)    │            │ id (UUID, PK)    │            │ folder_id (PK)   │
  │ zephyr_key       │◄───┐       │ zephyr_key       │            │ project_key      │
  │ project_key      │    │       │ project_key      │            │ name             │
  │ name             │    └───────│ action           │            │ parent_id        │
  │ status           │            │ actor_account    │            │ full_path        │
  │ priority         │            │ changed_fields   │            │ synced_at        │
  │ folder_id        │            │ diff_before      │            └──────────────────┘
  │ folder_path      │            │ diff_after       │
  │ owner_account    │            │ folder_before    │
  │ steps_hash       │            │ folder_after     │
  │ raw_snapshot     │            │ detected_at      │
  │ last_seen_at     │            │ alerted (BOOL)   │
  │ is_deleted (BOOL)│            └──────────────────┘
  └──────────────────┘
```

### 4.1 `test_case_state` Table
Stores the last known "clean" state of every test case.
*   `zephyr_key` (String, Unique Index): E.g., `QA-T4045`.
*   `steps_hash` (String): SHA-256 hash of the core structural fields. Used to detect updates instantly.
*   `raw_snapshot` (JSONB): The entire raw JSON payload returned by Zephyr. Crucial for backtracking historical data.

### 4.2 `audit_log` Table
Stores a chronological feed of every detected change.
*   `action` (String): `CREATED` | `UPDATED` | `MOVED` | `ARCHIVED` | `DELETED`.
*   `diff_before` (JSONB): The full `raw_snapshot` *before* the change occurred.
*   `diff_after` (JSONB): The full `raw_snapshot` *after* the change occurred.
*   `changed_fields` (Array of Strings): Populated with modified fields (e.g., `['priority', 'status']`).

### 4.3 `folder_map` Table
Stores a flat, resolved map of Zephyr folder hierarchies. Since folders are returned as parent IDs by the API, this table resolves them into a human-readable path string (e.g., `/CEFI/Trading/Futures`).

---

## 5. Synchronization & State Engine Logic

The core logic of the system is the **State Engine** inside the poller. It prevents API spam and eliminates false positives.

### 5.1 Preventing False-Positive Updates
Zephyr Scale updates internal timestamps (`updatedOn`) constantly. If we hashed the entire API response, every run would record thousands of fake "UPDATED" events.

To prevent this, the poller isolates the **"Meaningful Fields"** before hashing:

```python
def get_meaningful_fields(data: dict) -> dict:
    return {
        "name": data.get("name"),
        "status": (data.get("status") or {}).get("id"),
        "priority": (data.get("priority") or {}).get("id"),
        "folder": (data.get("folder") or {}).get("id"),
        "objective": data.get("objective"),
        "precondition": data.get("precondition"),
        "labels": sorted(data.get("labels") or []),
        "customFields": data.get("customFields") or {}
    }
```
Only changes within these specific fields will trigger a database `UPDATED` or `MOVED` log.

### 5.2 Dynamic Action Classification
When the poller detects that a test case's hash has changed, it compares the old folder ID with the new folder ID to classify the event correctly:
*   If `old_folder_id != new_folder_id`: The action is logged as **`MOVED`**, and the old folder path is saved to `folder_before`.
*   If the `status` changed to "Deprecated" or "Archived": The action is logged as **`ARCHIVED`**.
*   Otherwise: The action is logged as **`UPDATED`**.

---

## 6. Frontend Design, UI & UX Implementation

The frontend is built to resemble a high-density, engineering-focused cockpit. It borrows visual elements from **GitHub's PR Files Changed view** and **Zephyr's folder structure**.

### 6.1 Left Sidebar: Folder Context
The sidebar provides immediate context. It displays the active project scope (`QA Mobile Board`) and the structural breadcrumb path (`CEFI > Trading > Futures`) to remind the user of the active governing boundaries.

### 6.2 The Live Stream View (The "Git-Style Timeline")
*   **Chronological Feed:** Events are represented as high-density cards connected by a vertical timeline axis with colored status dots.
*   **Color-Coded Badges:** Green for `CREATED`, Yellow for `UPDATED`, Blue/Purple for `MOVED`.
*   **User Avatars:** Initials and usernames are extracted on the fly to show exactly *who* made the edit.

### 6.3 The Field-Level History Table (The "Zephyr Match")
To avoid cluttering the interface with raw JSON, the UI dynamically compares `diff_before` and `diff_after`. If a change is detected, it renders a clean, tabular view showing exactly what changed:

| Changed By | Date | Field | Original Value | New Value |
| :--- | :--- | :--- | :--- | :--- |
| Mani Reddy | 25 May, 17:20 | **Priority** | `Low` (Red strike) | `Normal` (Green badge) |
| Mani Reddy | 25 May, 17:20 | **Can Be Automated In Api** | `No` | `Yes` |

*Custom Fields Support:* The frontend automatically reads custom fields (like automation status or migration flags), cleans their labels (e.g., converting `can_be_automated_in_api` to `Can Be Automated In Api`), and inserts them cleanly into the table.

### 6.4 The Repository View
Directly queries `/api/testcases` to show all **2,840** currently synced test cases. It bypasses Zephyr's API query limits, allowing you to search, sort, and browse your entire local database snapshot instantly.

---

## 7. Implementation Approach & Phased Execution

To build this safely and verify every layer, we used a strict phased approach:

*   **Phase 1 (Database Validation):** Setup local PostgreSQL in Docker and compiled the SQLAlchemy models. Verified table creation via a safe initialization script.
*   **Phase 2 (API Investigation):** Discovered that the numeric Jira Project ID (`10060`) differed from the Zephyr API Project Key (`QA`). Used a direct `httpx` script to bypass the MCP parser and retrieve the raw JSON schema for case `QA-T4045`.
*   **Phase 3 (Recursive Sync):** Built a folder-by-folder traversal script. Resolved the "Futures" parent folder ID (`24734755`) and recursively mapped 162 subfolders, successfully syncing all **2,648** baseline cases.
*   **Phase 4 (Diff Tuning):** Re-engineered the backend hashing mechanism to ignore unstable Jira metadata and only look at core fields, eliminating noisy fake updates.
*   **Phase 5 (React Integration):** Shifted from Streamlit to full React/Tailwind. Fixed the `asyncio` JavaScript syntax bug and restored the multi-tab (Stream/Repo/Config) layout, completing the visual implementation.

---

## 8. Operational Scope & Maintenance Guide

### 8.1 Daily Automation (Cron/Task Scheduler)
To keep the system fully automated, set up a cron job on your local machine or server to run the poller every hour:

```bash
# Run the poller every hour (creates audit logs in database)
0 * * * * cd /Users/maniteja/zephyr-audit-system && ./venv/bin/python poller.py >> poller.log 2>&1
```

### 8.2 Team Hosting
To make the dashboard accessible to your entire QA tribe:
1.  **Host the API:** Run `api.py` on an internal virtual machine (VM) or container (port `8000`).
2.  **Host the Frontend:** Run `npm run build` inside the `/ui` folder, and serve the static files using Nginx or Apache.
3.  Any team member can then open the dashboard in their browser to view real-time governance logs.