FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY netlify ./netlify
COPY public ./public
COPY server ./server
ENV PORT=8080 DATA_DIR=/data LOCAL_CDN=1
VOLUME /data
EXPOSE 8080
CMD ["node", "server/index.mjs"]
