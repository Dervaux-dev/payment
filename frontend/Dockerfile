# Build stage
FROM node:22-alpine as build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx configuration to support React router and reverse proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets to Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
