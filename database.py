from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from config import get_settings

settings = get_settings()
DATABASE_URL = settings.database_url

# echo=False prevents logging every SQL query to console (set to True for debugging)
engine = create_async_engine(DATABASE_URL, echo=False)

# This factory generates new async database sessions
AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

Base = declarative_base()

# Dependency injector / Context Manager for DB sessions
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
