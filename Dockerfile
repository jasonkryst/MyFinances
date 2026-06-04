# Stage 1: Use a minimal build stage (no build tools needed for pure static app)
FROM nginx:1.27-alpine AS production

# Remove default nginx config and content
# Strip the 'user' directive from the main nginx.conf — it causes a warning
# (and will fatal-error on some setups) when the master process is non-root
RUN rm /etc/nginx/conf.d/default.conf && \
    rm -rf /usr/share/nginx/html/* && \
    sed -i '/^user /d' /etc/nginx/nginx.conf && \
    sed -i 's|pid\s*/var/run/nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/myfinances.conf

# Copy application files
COPY index.html styles.css /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/

# Set correct ownership and permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Run as non-root user
USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
