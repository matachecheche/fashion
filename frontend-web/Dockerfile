FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
# API URL is public configuration, baked into the Vite bundle at build time.
# Keep /api for local Docker Compose (nginx.conf proxies to the `backend` service).
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache ca-certificates
# Local Compose proxies to `backend`; Azure uses a runtime Nginx template and
# receives API_UPSTREAM from the deployment script at container start.
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
