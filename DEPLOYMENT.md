# Deployment Guide - MyFinances

This guide covers deployment options and security configurations for MyFinances.

**Last Updated**: June 4, 2026 | **CSP Status**: Enhanced - 'unsafe-inline' removed

## Quick Start - Local Development

### Using Python HTTP Server
```bash
cd "path/to/Debt Tracker"
python -m http.server 5500
```
Access at: `http://localhost:5500`

### Using PowerShell HTTP Listener
```powershell
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:5500/')
$listener.Start()
Write-Output 'Serving http://localhost:5500/'

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($path)) { $path = 'index.html' }
    
    $localPath = Join-Path (Get-Location) $path
    
    if ((Test-Path $localPath) -and -not (Get-Item $localPath).PSIsContainer) {
        $bytes = [System.IO.File]::ReadAllBytes($localPath)
        $ext = [System.IO.Path]::GetExtension($localPath).ToLowerInvariant()
        
        $contentType = switch ($ext) {
            '.html' { 'text/html; charset=utf-8' }
            '.js' { 'application/javascript; charset=utf-8' }
            '.css' { 'text/css; charset=utf-8' }
            '.json' { 'application/json; charset=utf-8' }
            '.svg' { 'image/svg+xml' }
            '.png' { 'image/png' }
            default { 'application/octet-stream' }
        }
        
        # ADD SECURITY HEADERS HERE
        $context.Response.AddHeader('X-Content-Type-Options', 'nosniff')
        $context.Response.AddHeader('X-Frame-Options', 'DENY')
        $context.Response.AddHeader('X-XSS-Protection', '1; mode=block')
        $context.Response.AddHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
        
        $context.Response.StatusCode = 200
        $context.Response.ContentType = $contentType
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $msg = [Text.Encoding]::UTF8.GetBytes('Not Found')
        $context.Response.StatusCode = 404
        $context.Response.ContentType = 'text/plain; charset=utf-8'
        $context.Response.ContentLength64 = $msg.Length
        $context.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    
    $context.Response.OutputStream.Close()
}
```

## Production Deployment

### Recommended Architecture
```
Internet ← HTTPS → Web Server (Nginx/Apache) ← HTTP → MyFinances (Static Files)
                   ↓
                Security Headers
                CSP Policy
                Cache Control
```

### Nginx Configuration

**File: `/etc/nginx/sites-available/myfinances`**

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # Content Security Policy (already in HTML meta tag, but can also set via header)
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    # Cache Configuration
    location ~* \.(html)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Root directory
    root /var/www/myfinances;
    index index.html;

    # Single Page Application routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Deny access to hidden files
    location ~ /\. {
        deny all;
    }

    # Deny access to test files
    location ~ /(tests|tests/*)$ {
        deny all;
    }
}
```

### Apache Configuration

**File: `.htaccess`**

```apache
# Enable mod_headers
<IfModule mod_headers.c>
    # Security Headers
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
    
    # Content Security Policy (matches HTML meta tag, no 'unsafe-inline')
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
</IfModule>

# Enable GZIP Compression
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>

# Cache Control
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType text/html "access 1 hour"
    ExpiresByType text/css "access 1 year"
    ExpiresByType text/javascript "access 1 year"
    ExpiresByType application/javascript "access 1 year"
    ExpiresByType image/png "access 1 year"
    ExpiresByType image/jpeg "access 1 year"
    ExpiresByType image/svg+xml "access 1 year"
</IfModule>

# Deny access to hidden files
<FilesMatch "^\.|^tests">
    <IfModule mod_authz_core.c>
        Require all denied
    </IfModule>
</FilesMatch>

# Single Page Application routing
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</IfModule>
```

### Docker Deployment

The repository ships with production-ready Docker files. The image is built on `nginx:1.27-alpine` and runs as the non-root `nginx` user.

**Files provided:**
- `Dockerfile` — multi-stage-ready build; copies only `index.html`, `styles.css`, and `src/`
- `nginx.conf` — custom nginx config with all security headers and 1-year asset caching
- `docker-compose.yml` — hardened Compose config (read-only filesystem, dropped capabilities)
- `.dockerignore` — excludes tests, docs, Python cache, and editor files from the build context

**Build and run with Docker:**

```bash
# Build the image
docker build -t myfinances .

# Run on port 5500
docker run -d -p 5500:80 --name myfinances myfinances
```

Access at: `http://localhost:5500`

**Build and run with Docker Compose (recommended):**

```bash
# Start (detached)
docker compose up -d

# View logs
docker compose logs -f

# Stop and remove container
docker compose down
```

Access at: `http://localhost:5500`

**Security hardening applied in `docker-compose.yml`:**
- `read_only: true` — container filesystem is read-only
- `tmpfs` mounts for `/tmp`, `/var/cache/nginx`, `/var/run`
- `no-new-privileges:true` — prevents privilege escalation
- `cap_drop: ALL` with only `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE` re-added
- Built-in healthcheck via `wget`

### GitHub Pages Deployment

1. Push code to GitHub repository
2. Go to Settings → Pages
3. Select source: `main` branch
4. Select folder: `/ (root)`
5. Click "Save"

**Note**: GitHub Pages serves all files via HTTPS with appropriate security headers by default.

## Security Configuration Checklist

- [ ] HTTPS enabled (valid SSL/TLS certificate)
- [ ] Security headers configured (all 5 headers added)
- [ ] CSP policy in place (via meta tag or header)
- [ ] X-Frame-Options set to DENY
- [ ] Test files not publicly accessible
- [ ] `.git` directory not exposed
- [ ] `.env` files excluded from deployment
- [ ] Cache headers configured appropriately
- [ ] GZIP compression enabled
- [ ] Regular backups implemented

## Testing Deployment

### Security Header Verification

Using curl:
```bash
curl -I https://your-domain.com

# Should show:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# X-XSS-Protection: 1; mode=block
# Referrer-Policy: strict-origin-when-cross-origin
# Strict-Transport-Security: ...
```

### Security Scanning

Using online tools:
- **Mozilla Observatory**: https://observatory.mozilla.org
- **SSL Labs**: https://www.ssllabs.com/ssltest/
- **SecurityHeaders.com**: https://securityheaders.com

### Functionality Testing

```bash
# Run tests
python tests/smoke_playwright.py
python tests/test_security.py
```

## Performance Optimization

### Enable Caching
- Cache static assets (JS, CSS, images) for 1 year
- Cache HTML for 1 hour
- Use CDN for faster delivery

### Enable Compression
- GZIP compression for text files
- Reduces bandwidth usage
- Improves load times

### Content Delivery
- Serve from multiple geographic locations
- Use CDN providers (Cloudflare, AWS CloudFront)
- Implement geographic load balancing

## Monitoring and Maintenance

### Regular Tasks
- Check security headers monthly
- Review CSP violations (if logging enabled)
- Monitor application logs
- Update certificates before expiration
- Keep server software updated

### Automated Monitoring
```bash
# Check if application is running
curl -s https://your-domain.com | grep -q '<title>MyFinances' && echo "OK" || echo "FAILED"

# Monitor certificate expiration
openssl s_client -servername your-domain.com -connect your-domain.com:443 < /dev/null | openssl x509 -noout -dates
```

## Troubleshooting

### CSP Violations
- Check browser console for CSP errors
- Verify all resources use HTTPS
- Review CSP policy for overly restrictive rules

### CORS Issues
- Verify request origin
- Check server CORS configuration
- Ensure requests match Same-Origin Policy

### Performance Issues
- Enable caching headers
- Enable compression
- Check network waterfall in DevTools
- Verify CDN is working

## Support

For deployment questions or issues, please refer to:
- `SECURITY.md` - Security configuration details
- `README.md` - General project information
- Server documentation for your hosting platform

---

**Last Updated:** May 29, 2026  
**Version:** 1.0
