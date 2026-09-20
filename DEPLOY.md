# Деплой на DigitalOcean

Домен: `erzat-timers.duckdns.org`  
Приложение: Node.js + Express + WebSocket + PostgreSQL

## 1. Подготовить PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql
sudo systemctl enable --now postgresql
sudo -u postgres psql
```

В консоли PostgreSQL выполните, заменив пароль на свой новый пароль:

```sql
CREATE USER timers_app WITH PASSWORD 'NEW_STRONG_PASSWORD';
CREATE DATABASE timers OWNER timers_app;
\q
```

## 2. Настроить проект

```bash
cd ~/app
npm ci
cp .env-sample .env
nano .env
```

Содержимое `.env`:

```env
PORT=3000
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=timers_app
DB_PASSWORD=NEW_STRONG_PASSWORD
DB_NAME=timers
```

Затем:

```bash
chmod 600 .env
npm run db:migrate
pm2 start npm --name timers -- start
pm2 save
```

Приложение запускайте только в одном экземпляре PM2.

## 3. Настроить Nginx

Файл `/etc/nginx/sites-available/erzat-timers.duckdns.org`:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name erzat-timers.duckdns.org;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400;
    }
}
```

Активировать и проверить конфигурацию:

```bash
sudo ln -sfn /etc/nginx/sites-available/erzat-timers.duckdns.org /etc/nginx/sites-enabled/erzat-timers.duckdns.org
sudo nginx -t
sudo systemctl reload nginx
```

Если HTTPS ещё не настроен:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erzat-timers.duckdns.org
```

## 4. Проверить

```bash
pm2 status
pm2 logs timers --lines 50
curl -I http://127.0.0.1:3000
curl -I https://erzat-timers.duckdns.org
```

В браузере откройте `https://erzat-timers.duckdns.org`, зарегистрируйтесь,
создайте таймер и остановите его. В инструментах разработчика на вкладке
Network → WS должно быть активное соединение `wss://erzat-timers.duckdns.org`.

## Безопасность

- Не добавляйте `.env` в GitHub.
- Не добавляйте `node_modules` в GitHub.
- Старый пароль, ранее находившийся в `.env-sample`, следует считать раскрытым
  и не использовать на сервере.
