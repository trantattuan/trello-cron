FROM node:20-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY package.json ./
COPY index.js ./
RUN chown -R app:app /app
USER app
CMD ["node", "index.js"]
