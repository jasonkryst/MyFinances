# Stage 1: Use a minimal build stage (no build tools needed for pure static app)
FROM nginx:1.27-alpine AS production

# Remove default nginx config and content
# Strip the 'user' directive from the main nginx.conf — it causes a warning
# (and will fatal-error on some setups) when the master process is non-root
# Replace pid location with /tmp (writable by non-root) instead of /run or /var/run
RUN rm /etc/nginx/conf.d/default.conf && \
    rm -rf /usr/share/nginx/html/* && \
    sed -i '/^user /d' /etc/nginx/nginx.conf && \
    sed -i 's|pid.*nginx\.pid|pid /tmp/nginx.pid|' /etc/nginx/nginx.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/myfinances.conf

# Copy application files
COPY index.html styles.css styles-csp-classes.css guide.html /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/

# Set correct ownership and permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Pre-create nginx cache and runtime directories with correct ownership
# These are needed for nginx to run as non-root; they'll be mounted as tmpfs at runtime
RUN mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp \
             /var/run/nginx && \
    chown -R nginx:nginx /var/cache/nginx /var/run/nginx && \
    chmod -R 755 /var/cache/nginx /var/run/nginx

# Run as non-root user
USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
