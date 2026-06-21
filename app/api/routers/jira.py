import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.api.dependencies import require_api_key

settings = get_settings()

router = APIRouter(prefix="/api/jira", tags=["jira"])


@router.get("/issue/{issue_key}", dependencies=[Depends(require_api_key)])
async def get_jira_issue_status(issue_key: str):
    if not settings.jira_base_url or not settings.jira_api_token or not settings.jira_user_email:
        raise HTTPException(status_code=501, detail="Jira integration not configured.")

    url = f"{settings.jira_base_url}/rest/api/3/issue/{issue_key}?fields=status"
    auth = (settings.jira_user_email, settings.jira_api_token)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, auth=auth)
            response.raise_for_status()
            data = response.json()
            return {"key": issue_key, "status": data['fields']['status']['name']}
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return {"key": issue_key, "status": "Not Found"}
            raise HTTPException(status_code=e.response.status_code, detail=f"Jira API error: {e.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
