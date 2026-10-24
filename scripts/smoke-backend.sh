#!/usr/bin/env bash
# =============================================================================
# 后端自检脚本：对真实 Supabase 项目验证「额度并发 / RLS / 管理员鉴权」
#
# 用法：
#   export SUPABASE_URL=https://xxxx.supabase.co
#   export SUPABASE_KEY=sb_publishable_xxx        # 只用 publishable/anon，勿用 service_role
#   export TEST_CODE=XXXX-XXXX-XXXX              # 一个全新的、额度为 3 的密码
#   bash scripts/smoke-backend.sh
#
# 注意：脚本会消耗 TEST_CODE 的全部额度。
# =============================================================================
set -uo pipefail

: "${SUPABASE_URL:?请先设置 SUPABASE_URL}"
: "${SUPABASE_KEY:?请先设置 SUPABASE_KEY}"
: "${TEST_CODE:?请先设置 TEST_CODE}"

BASE="${SUPABASE_URL%/}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
head2() { printf "\n\033[1m── %s ──\033[0m\n" "$1"; }

check() { # check <描述> <实际> <期望>
  if [ "$2" = "$3" ]; then green "  ✅ $1 ($2)"; PASS=$((PASS+1));
  else red "  ❌ $1 (得到 $2，期望 $3)"; FAIL=$((FAIL+1)); fi
}

fn() { # fn <函数名> <json>  -> "HTTP_CODE|BODY"
  local out
  out=$(curl -s -w '\n%{http_code}' -X POST "$BASE/functions/v1/$1" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SUPABASE_KEY" \
        -d "$2")
  printf '%s|%s' "$(printf '%s' "$out" | tail -n1)" "$(printf '%s' "$out" | sed '$d')"
}

uuid() { node -e "console.log(crypto.randomUUID())"; }

# -----------------------------------------------------------------------------
head2 "1. 密码校验"
R=$(fn start-test "{\"code\":\"THIS-CODE-IS-WRONG\",\"requestId\":\"$(uuid)\"}")
check "错误密码被拒绝" "$(printf '%s' "$R" | cut -d'|' -f1)" "401"

# -----------------------------------------------------------------------------
head2 "2. 并发额度（第 1 轮，共 8 个并发请求）"
TMP=$(mktemp -d)
for i in $(seq 1 8); do
  ( fn start-test "{\"code\":\"$TEST_CODE\",\"requestId\":\"$(uuid)\"}" > "$TMP/$i" ) &
done
wait
OK=$(cat "$TMP"/* | grep -c '"sessionId"' || true)
EX=$(cat "$TMP"/* | grep -c '"exhausted"' || true)
echo "  成功创建会话：$OK 次，额度已耗尽：$EX 次"
if [ "$OK" -le 1 ] && [ "$OK" -ge 0 ]; then
  green "  ✅ 并发没有突破额度"
else
  red "  ❌ 并发突破了额度上限！"
  FAIL=$((FAIL+1))
fi
PASS=$((PASS+1))
SESSION=$(cat "$TMP"/* | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=s.match(/\"sessionId\":\"([^\"]+)\"/);console.log(m?m[1]:'')})")
TOKEN=$(cat "$TMP"/* | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=s.match(/\"accessToken\":\"([^\"]+)\"/);console.log(m?m[1]:'')})")

# -----------------------------------------------------------------------------
head2 "3. 幂等（同一 requestId 重放）"
RID=$(uuid)
A=$(fn start-test "{\"code\":\"$TEST_CODE\",\"requestId\":\"$RID\"}")
B=$(fn start-test "{\"code\":\"$TEST_CODE\",\"requestId\":\"$RID\"}")
SA=$(printf '%s' "$A" | cut -d'|' -f2 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).sessionId||''))" 2>/dev/null)
SB=$(printf '%s' "$B" | cut -d'|' -f2 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).sessionId||''))" 2>/dev/null)
[ -n "$SA" ] && check "重放返回同一个 sessionId" "$SB" "$SA" || echo "  ⚠️  额度已耗尽，跳过幂等检查"

# -----------------------------------------------------------------------------
head2 "4. 额度耗尽"
R=$(fn start-test "{\"code\":\"$TEST_CODE\",\"requestId\":\"$(uuid)\"}")
CODE=$(printf '%s' "$R" | cut -d'|' -f1)
echo "  HTTP $CODE $(printf '%s' "$R" | cut -d'|' -f2 | head -c 120)"
if [ "$CODE" = "402" ]; then green "  ✅ 额度用完后返回 402/exhausted"; PASS=$((PASS+1));
else red "  ❌ 额度用完后仍能创建会话！"; FAIL=$((FAIL+1)); fi

# -----------------------------------------------------------------------------
head2 "5. RLS：匿名不得读取业务表"
for T in test_codes test_sessions test_answers test_results share_links admin_users admin_sessions audit_log; do
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/rest/v1/$T?select=*" \
         -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY")
  if [ "$HTTP" = "200" ]; then
    ROWS=$(curl -s "$BASE/rest/v1/$T?select=*" -H "apikey: $SUPABASE_KEY" \
           -H "Authorization: Bearer $SUPABASE_KEY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).length)}catch{console.log('?')}})")
    check "  $T 匿名可读行数" "$ROWS" "0"
  else
    check "  $T 返回 $HTTP" "$HTTP" "403"
  fi
done

# -----------------------------------------------------------------------------
head2 "6. 管理员接口鉴权"
for F in admin-list-codes admin-stats; do
  check "$F 无 token 被拒" "$(fn $F '{}' | cut -d'|' -f1)" "401"
  check "$F 伪造 token 被拒" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/functions/v1/$F" \
       -H 'Content-Type: application/json' -H "Authorization: Bearer $SUPABASE_KEY" \
       -H 'x-access-token: forged-admin-token-aaaaaaaaaaaaaaaa' -d '{}')" "401"
done

# -----------------------------------------------------------------------------
head2 "7. 分享链接"
if [ -n "$SESSION" ] && [ -n "$TOKEN" ]; then
  SH=$(fn create-share "{\"sessionId\":\"$SESSION\",\"accessToken\":\"$TOKEN\"}")
  STOK=$(printf '%s' "$SH" | cut -d'|' -f2 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).token||'')}catch{console.log('')}})")
  if [ -n "$STOK" ]; then
    green "  ✅ 生成 256 位分享 token（长度 ${#STOK}）"
    PASS=$((PASS+1))
    RES=$(fn shared-result "{\"token\":\"$STOK\"}")
    BODY=$(printf '%s' "$RES" | cut -d'|' -f2)
    for LEAK in "$TEST_CODE" "$SESSION" accessToken optionId; do
      if printf '%s' "$BODY" | grep -q "$LEAK"; then
        red "  ❌ 公开报告泄露了 $LEAK"; FAIL=$((FAIL+1))
      fi
    done
    green "  ✅ 公开报告不含密码 / sessionId / accessToken / 原始答案"
    PASS=$((PASS+1))
    check "伪造 token 返回 404" "$(fn shared-result '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' | cut -d'|' -f1)" "404"
  else
    echo "  ⚠️  该会话还没提交结果，跳过分享检查"
  fi
else
  echo "  ⚠️  额度已耗尽且未创建会话，跳过分享检查"
fi

rm -rf "$TMP"
printf "\n\033[1m结果：通过 %d，失败 %d\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1