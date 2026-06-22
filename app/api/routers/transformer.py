from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.db.models import TransformerConfig
from app.schemas.schemas import TransformerConfigSchema, TransformerConfigUpdate
from app.api.dependencies import require_api_key

router = APIRouter(tags=["transformer"])


@router.get("/api/transformer/config", response_model=TransformerConfigSchema, dependencies=[Depends(require_api_key)])
async def get_transformer_config(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Default transformer configuration not found.")
    return config


@router.put("/api/transformer/config", response_model=TransformerConfigSchema, dependencies=[Depends(require_api_key)])
async def update_transformer_config(config_update: TransformerConfigUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TransformerConfig).where(TransformerConfig.key == "default"))
    config = result.scalar_one_or_none()
    if not config:
        # Create it if it somehow doesn't exist
        config = TransformerConfig(key="default")
        db.add(config)
        
    update_data = config_update.model_dump(exclude_unset=True)
    
    if 'filler_verbs' in update_data:
        # Normalize verbs to lowercase for case-insensitive matching
        config.filler_verbs = [v.lower().strip() for v in update_data['filler_verbs'] if v.strip()]
        
    if 'generic_words' in update_data:
        # Normalize generic words to lowercase
        config.generic_words = [w.lower().strip() for w in update_data['generic_words'] if w.strip()]
        
    await db.commit()
    await db.refresh(config)
    return config
