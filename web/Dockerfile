# The website: built once, then served by Caddy, which also gives the site HTTPS (a free certificate for the domain in SITE_ADDRESS) and passes
# /api and /ws on to the backend container.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
