cat << 'EOF' > /etc/nginx/sites-available/hunterstaronline.online
server {
    listen 80;
    server_name hunterstaronline.online;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/hunterstaronline.online /etc/nginx/sites-enabled/hunterstaronline.online
certbot --nginx -d hunterstaronline.online --non-interactive --agree-tos -m admin@hunterstar.uz
systemctl restart nginx
