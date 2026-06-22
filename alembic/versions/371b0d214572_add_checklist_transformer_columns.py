"""add_checklist_transformer_columns

Revision ID: 371b0d214572
Revises: 
Create Date: 2026-06-21 23:30:47.488031

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '371b0d214572'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # 1. transformer_config table
    tables = inspector.get_table_names()
    if 'transformer_config' not in tables:
        op.create_table('transformer_config',
            sa.Column('key', sa.String(), nullable=False),
            sa.Column('filler_verbs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column('generic_words', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.PrimaryKeyConstraint('key')
        )

    # 2. checklist_items columns
    columns = [col['name'] for col in inspector.get_columns('checklist_items')]
    if 'checklist_label' not in columns:
        op.add_column('checklist_items', sa.Column('checklist_label', sa.String(), nullable=True))
    if 'module' not in columns:
        op.add_column('checklist_items', sa.Column('module', sa.String(), nullable=True))
    if 'verification_points' not in columns:
        op.add_column('checklist_items', sa.Column('verification_points', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    if 'precondition' not in columns:
        op.add_column('checklist_items', sa.Column('precondition', sa.Text(), nullable=True))
    if 'transform_version' not in columns:
        op.add_column('checklist_items', sa.Column('transform_version', sa.Integer(), nullable=True))
    if 'label_overridden' not in columns:
        op.add_column('checklist_items', sa.Column('label_overridden', sa.Boolean(), nullable=True))
        
    # alter column evidence type
    if 'evidence' in columns:
        op.alter_column('checklist_items', 'evidence',
                   existing_type=postgresql.JSONB(astext_type=sa.Text()),
                   type_=sa.JSON(),
                   existing_nullable=True)

    # 3. Indexes and constraints
    checklist_item_indexes = [idx['name'] for idx in inspector.get_indexes('checklist_items')]
    if 'ix_checklist_items_checklist_label' not in checklist_item_indexes:
        op.create_index(op.f('ix_checklist_items_checklist_label'), 'checklist_items', ['checklist_label'], unique=False)
    if 'ix_checklist_items_module' not in checklist_item_indexes:
        op.create_index(op.f('ix_checklist_items_module'), 'checklist_items', ['module'], unique=False)

    # parent_id foreign key constraint
    fk_exists = any(fk['constrained_columns'] == ['parent_id'] for fk in inspector.get_foreign_keys('checklist_items'))
    if not fk_exists:
        op.create_foreign_key(None, 'checklist_items', 'checklist_items', ['parent_id'], ['id'])

    # test_case_state indexes
    test_case_indexes = [idx['name'] for idx in inspector.get_indexes('test_case_state')]
    if 'idx_test_case_state_folder' not in test_case_indexes:
        op.create_index('idx_test_case_state_folder', 'test_case_state', ['folder_id'], unique=False)
    if 'idx_test_case_state_project_deleted' not in test_case_indexes:
        op.create_index('idx_test_case_state_project_deleted', 'test_case_state', ['project_key', 'is_deleted'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    tables = inspector.get_table_names()
    if 'transformer_config' in tables:
        op.drop_table('transformer_config')

    columns = [col['name'] for col in inspector.get_columns('checklist_items')]
    
    test_case_indexes = [idx['name'] for idx in inspector.get_indexes('test_case_state')]
    if 'idx_test_case_state_project_deleted' in test_case_indexes:
        op.drop_index('idx_test_case_state_project_deleted', table_name='test_case_state')
    if 'idx_test_case_state_folder' in test_case_indexes:
        op.drop_index('idx_test_case_state_folder', table_name='test_case_state')
        
    fk_exists = any(fk['constrained_columns'] == ['parent_id'] for fk in inspector.get_foreign_keys('checklist_items'))
    if fk_exists:
        op.drop_constraint(None, 'checklist_items', type_='foreignkey')
        
    checklist_item_indexes = [idx['name'] for idx in inspector.get_indexes('checklist_items')]
    if 'ix_checklist_items_module' in checklist_item_indexes:
        op.drop_index(op.f('ix_checklist_items_module'), table_name='checklist_items')
    if 'ix_checklist_items_checklist_label' in checklist_item_indexes:
        op.drop_index(op.f('ix_checklist_items_checklist_label'), table_name='checklist_items')
        
    if 'evidence' in columns:
        op.alter_column('checklist_items', 'evidence',
                   existing_type=sa.JSON(),
                   type=postgresql.JSONB(astext_type=sa.Text()),
                   existing_nullable=True)
                   
    if 'label_overridden' in columns:
        op.drop_column('checklist_items', 'label_overridden')
    if 'transform_version' in columns:
        op.drop_column('checklist_items', 'transform_version')
    if 'precondition' in columns:
        op.drop_column('checklist_items', 'precondition')
    if 'verification_points' in columns:
        op.drop_column('checklist_items', 'verification_points')
    if 'module' in columns:
        op.drop_column('checklist_items', 'module')
    if 'checklist_label' in columns:
        op.drop_column('checklist_items', 'checklist_label')

