# CV-Hub DevOps & Deployment Guide

**Last Updated:** 2026-01-06
**Status:** Production

---

## Infrastructure Overview

### Hosting Platform
- **Provider:** DigitalOcean
- **Region:** NYC1
- **Cluster:** `do-nyc1-cv-hub-cluster` (Kubernetes)

### Services Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    DigitalOcean                              │
├─────────────────────────────────────────────────────────────┤
│  Kubernetes Cluster (cv-hub namespace)                       │
│  ├── cv-hub-web (nginx serving React SPA)                   │
│  ├── cv-hub-api (Node.js/Hono API server)                   │
│  └── cv-hub-worker (background jobs - scaled to 0)          │
├─────────────────────────────────────────────────────────────┤
│  Managed PostgreSQL Database                                 │
│  └── cv-hub-db (primary database)                           │
├─────────────────────────────────────────────────────────────┤
│  DigitalOcean Spaces (S3-compatible storage)                │
│  └── cv-hub-storage (release assets, file downloads)        │
├─────────────────────────────────────────────────────────────┤
│  Container Registry                                          │
│  └── cv-hub-registry (Docker images)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Domain Configuration

### DNS Records (Cloudflare)
| Subdomain | Type | Target | Purpose |
|-----------|------|--------|---------|
| `hub.controlvector.io` | A | 137.184.241.129 | Web frontend |
| `api.hub.controlvector.io` | A | 137.184.241.129 | API server |
| `git.hub.controlvector.io` | A | 137.184.241.129 | Git operations |

### SSL/TLS
- **Certificate Manager:** cert-manager with Let's Encrypt
- **Issuer:** `letsencrypt-prod`
- **Secret:** `hub-controlvector-tls`

---

## Access Credentials & Tokens

### DigitalOcean
- **Console:** https://cloud.digitalocean.com
- **API Token:** Required for `doctl` CLI (personal access token)
- **Registry:** `registry.digitalocean.com/cv-hub-registry`

### DigitalOcean Spaces (S3 Storage)
- **Endpoint:** `https://nyc3.digitaloceanspaces.com`
- **Bucket:** `cv-hub-storage`
- **Region:** `nyc3`
- **Access Key ID:** `DO8012BRJM3YVFRKGZCX`
- **Secret Key:** Stored in Kubernetes secret `cv-hub-secrets`
- **Console:** https://cloud.digitalocean.com/spaces/cv-hub-storage

### GitHub OAuth (for user account linking)
- **App Settings:** https://github.com/settings/developers
- **Client ID:** `Ov23liv38oE0bMQlO0TK`
- **Client Secret:** Stored in Kubernetes secret `cv-hub-secrets`
- **Callback URL:** `https://api.hub.controlvector.io/api/github/callback`
- **Scopes:** `read:user`, `user:email`, `repo` (for private repo access)

### Database
- **Host:** Managed by DigitalOcean (connection string in secrets)
- **Connection:** Via `DATABASE_URL` environment variable
- **Access:** Only from within Kubernetes cluster

---

## Kubernetes Resources

### Namespaces
- `cv-hub` - Application workloads
- `cert-manager` - SSL certificate management
- `ingress-nginx` - Ingress controller

### Key Resources
```bash
# Deployments
kubectl get deployments -n cv-hub
# cv-hub-api, cv-hub-web, cv-hub-worker

# Services
kubectl get svc -n cv-hub
# cv-hub-api (ClusterIP:3000), cv-hub-web (ClusterIP:80)

# Secrets
kubectl get secrets -n cv-hub
# cv-hub-secrets (all sensitive config)

# Ingress
kubectl get ingress -n cv-hub
# cv-hub-ingress (routes for all 3 domains)
```

### Secret Keys (cv-hub-secrets)
| Key | Description |
|-----|-------------|
| `database-url` | PostgreSQL connection string |
| `jwt-secret` | JWT signing key |
| `jwt-refresh-secret` | Refresh token signing key |
| `github-client-id` | GitHub OAuth client ID |
| `github-client-secret` | GitHub OAuth client secret |
| `s3-endpoint` | Spaces endpoint URL |
| `s3-bucket` | Spaces bucket name |
| `s3-access-key` | Spaces access key |
| `s3-secret-key` | Spaces secret key |
| `s3-region` | Spaces region |

---

## Deployment Commands

### Prerequisites
```bash
# Authenticate with DigitalOcean
doctl auth init

# Connect to Kubernetes cluster
doctl kubernetes cluster kubeconfig save cv-hub-cluster

# Authenticate Docker with registry
doctl registry login
```

### Build & Deploy API
```bash
cd /home/schmotz/project/cv-hub

# Build
docker build -f Dockerfile.api -t registry.digitalocean.com/cv-hub-registry/api:latest .

# Push
docker push registry.digitalocean.com/cv-hub-registry/api:latest

# Deploy
kubectl rollout restart deployment cv-hub-api -n cv-hub
kubectl rollout status deployment cv-hub-api -n cv-hub
```

### Build & Deploy Web
```bash
cd /home/schmotz/project/cv-hub

# Build (includes VITE_API_URL baked in)
docker build -f Dockerfile.web -t registry.digitalocean.com/cv-hub-registry/web:latest .

# Push
docker push registry.digitalocean.com/cv-hub-registry/web:latest

# Deploy
kubectl rollout restart deployment cv-hub-web -n cv-hub
kubectl rollout status deployment cv-hub-web -n cv-hub
```

### Database Migrations
```bash
# Run from API pod
kubectl exec -it deployment/cv-hub-api -n cv-hub -- pnpm db:migrate
```

---

## Environment Variables

### API Server
| Variable | Source | Description |
|----------|--------|-------------|
| `NODE_ENV` | ConfigMap | `production` |
| `PORT` | ConfigMap | `3000` |
| `API_URL` | ConfigMap | `https://api.hub.controlvector.io` |
| `APP_URL` | ConfigMap | `https://hub.controlvector.io` |
| `DATABASE_URL` | Secret | PostgreSQL connection |
| `JWT_SECRET` | Secret | Token signing |
| `STORAGE_TYPE` | ConfigMap | `s3` |
| `S3_*` | Secret | Storage credentials |
| `GITHUB_CLIENT_*` | Secret | OAuth credentials |

### Web Frontend (Build-time)
| Variable | Value | Description |
|----------|-------|-------------|
| `VITE_API_URL` | `https://api.hub.controlvector.io/api` | API base URL |
| `VITE_APP_URL` | `https://hub.controlvector.io` | App URL |

---

## Monitoring & Debugging

### View Logs
```bash
# API logs
kubectl logs -f deployment/cv-hub-api -n cv-hub

# Web logs
kubectl logs -f deployment/cv-hub-web -n cv-hub

# All pods
kubectl logs -f -l app.kubernetes.io/part-of=cv-hub -n cv-hub
```

### Check Pod Status
```bash
kubectl get pods -n cv-hub
kubectl describe pod <pod-name> -n cv-hub
```

### Database Access
```bash
# Connect to database from API pod
kubectl exec -it deployment/cv-hub-api -n cv-hub -- sh
# Then use psql or node scripts
```

---

## File Storage (DigitalOcean Spaces)

### Upload Script
Located at: `apps/api/scripts/upload-to-spaces.ts`

```bash
cd /home/schmotz/project/cv-hub/apps/api
S3_SECRET_KEY='<secret>' npx tsx scripts/upload-to-spaces.ts
```

### Storage Key Format
```
releases/{appId}/{version}/{fileName}
```

Example: `releases/cv-git/0.4.3/cv-git_0.4.3_amd64.deb`

### Public Access
Files uploaded with `x-amz-acl: public-read` header.
Direct URL: `https://nyc3.digitaloceanspaces.com/cv-hub-storage/{key}`

---

## Ingress Configuration

### Routing Rules
```yaml
hub.controlvector.io/* -> cv-hub-web:80
api.hub.controlvector.io/* -> cv-hub-api:3000
git.hub.controlvector.io/* -> cv-hub-api:3000
```

### Important Notes
- API routes include `/api` prefix in the URL
- Frontend VITE_API_URL is `https://api.hub.controlvector.io/api` (with `/api`)
- Download URLs: `https://api.hub.controlvector.io/api/v1/apps/{appId}/download/{platform}`

---

## Cost Estimates

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| Kubernetes Cluster (2 nodes) | ~$24 |
| Managed PostgreSQL | ~$15 |
| Spaces Storage | ~$5 (250GB) |
| Container Registry | ~$5 |
| **Total** | **~$49/month** |
