#!/usr/bin/env bash
set -a
EXAMPLES=${1:-"create-msa"}

RES=`curl -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' http://127.0.0.1:9944 --silent | jq .jsonrpc`
 if [ "${RES}"=="2.0" ] ; then
  for example in ${EXAMPLES} ; do
      npm run run-example --example=${example}
  done
else
  echo $RES
  echo "chain is not ready; start chain first with 'npm run chain:start'"
  exit 1
fi
