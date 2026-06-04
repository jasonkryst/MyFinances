# Stage 1: Use a minimal build stage (no build tools needed for pure static app)
FROM nginx:1.27-alpine AS production

# Remove default nginx config and content
RUN rm /etc/nginx/conf.d/default.conf && \
    rm -rf /usr/share/nginx/html/*

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
