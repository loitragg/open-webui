# Qdrant Multi-Tenancy Migration Plan

## Problem Statement

Currently, Open WebUI is using a separate Qdrant collection for each entity (user memory, knowledge base, file), leading to approximately 1366 collections. This approach:

- Requires excessive RAM (~14MB overhead per collection = ~18GB total) exceeding the available 4GB
- Creates performance issues with the database
- Is an anti-pattern according to Qdrant documentation

## Solution: Migrate to Qdrant's Multi-Tenancy Feature

Qdrant recommends using multi-tenancy with payload-based partitioning for efficient resource usage when dealing with a large number of logical collections.

### Inefficiencies

This approach has several inefficiencies when implementing multi-tenancy:

- **Collection Explosion**: As user base grows, the number of collections will explode
- **Inefficient Resource Usage**: Qdrant indexes each collection separately, leading to higher memory usage
- **Management Complexity**: Tracking and managing thousands of collections becomes difficult
- **Performance Overhead**: Switching between many collections can cause performance degradation

## Target Architecture

1. **Consolidate Collections**: Group by entity type rather than creating individual collections
2. **Add Tenant IDs**: Use tenant_id field in payloads to partition data
3. **Optimize for Multi-Tenancy**: Configure collections with appropriate settings
4. **Maintain Interface**: Keep the existing API interface to avoid breaking changes


### Collection Configuration

Each collection will be configured for multi-tenancy:
- `payload_m=16` to enable per-tenant indexing
- `m=0` to disable building a global index
- Create keyword payload index for `tenant_id` field with `is_tenant=true`

## Addressing Global Query Performance

The Qdrant documentation notes that global queries (without tenant_id filters) may be slower. Analysis of the Open WebUI codebase shows:

1. Global queries are used primarily for:
   - Hybrid search (combining vector and keyword search)
   - Retrieving all data from a collection

2. Queries are always scoped to a collection level (not cross-collection)

3. Our solution mitigates performance concerns by:
   - Grouping collections by entity type
   - Maintaining tenant-level isolation with filters
   - Ensuring global queries are still scoped to individual tenants
   - Using Qdrant's optimized storage for multi-tenancy with `is_tenant=true`



## Proposed Solution: Multi-Tenant Collections

We will migrate to a multi-tenant architecture with a small number of main collections, each handling a specific data type:

1. **Memories Collection**: For user memory data
2. **Files Collection**: For file embeddings
3. **Knowledge Collection**: For knowledge base data
4. **Web Search Collection**: For web search results
5. **YouTube Collection**: For YouTube video content and web URL content


Each collection will use Qdrant's tenant isolation features:
- Using `tenant_id` field in payloads
- Per-tenant indexing with `is_tenant=True` setting
- Disabling global indexing for better isolation


# Qdrant Multi-Tenancy Migration Guide

## Background

Open WebUI originally used a separate Qdrant collection for each entity (memory, knowledge base, file), which led to thousands of collections. This approach is an anti-pattern according to Qdrant documentation and causes excessive RAM usage.

This migration guide will help you move your Qdrant database to use the multi-tenancy feature, which is more efficient and recommended by Qdrant.

We'll update the existing `QdrantClient` class to use Qdrant's multi-tenancy feature while maintaining the same interface to avoid breaking changes in the application.


## Rollback

**Before running the migration in production:**

1. **Backup your database**: Create a snapshot of your Qdrant database 
2. **Test in a staging environment**: Try the migration in a non-production environment first

If you need to roll back, restore from your backup.

## Benefits of Multi-Tenancy

- **Reduced RAM usage**: Significant decrease from ~14MB overhead per collection
- **Improved performance**: Better resource utilization
- **Optimized storage**: Data from the same tenant is co-located
- **Simplified management**: Fewer collections to manage
