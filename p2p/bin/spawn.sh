export SERVER=ws://localhost:6000/service

WORKERS=""

for i in {0..11}
do
  PORT=$((2000+$i))
  WORKERS="http://localhost:$PORT,$WORKERS"
  PORT=$PORT node --trace-warnings --abort-on-uncaught-exception --unhandled-rejections=strict dist/client.js &
done

WORKERS=$WORKERS node --trace-warnings --abort-on-uncaught-exception --unhandled-rejections=strict dist/observer.js 
