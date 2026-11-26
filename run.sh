#!/bin/bash
# AwaazAI dev server — http://127.0.0.1:8000
# Legacy naam: ab ye start.sh ki taraf point karta hai, jo server start
# karke browser mein page bhi khol deta hai. Seedha ./start.sh bhi chala
# sakte hain — dono se ek hi kaam hota hai.
set -e
cd "$(dirname "$0")"
exec ./start.sh "$@"
