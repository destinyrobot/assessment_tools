import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import {
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  type AdminSession,
} from '@/lib/storage';
import { Button } from '@/components/ui/Button';
import { Card, SectionTitle, Tag } from '@/components/ui/Card';
import { Layout } from '@/components/Layout';
import { Dialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/toast';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import type { AdminCodeRow, AdminStats } from '@/lib/api';

/**
 * Admin console.
 * SECURITY: hiding the route in the front-end is only cosmetic. Every request
 * is authorised server-side by an opaque admin token that is verified against
 * `admin_sessions` inside the Edge Function.
 */
export function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(() => loadAdminSession());
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setBooting(false);
  }, []);

  if (booting) {
    return (
      <Layout>
        <FullPageLoader label="正在检查管理员身份…" />
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <AdminLogin onSuccess={setSession} />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-wide text-ink">测试密码管理</h1>
            <p className="mt-1 text-[13px] text-brown-muted">
              当前管理员：<span className="font-medium text-brown-soft">{session.username}</span> · 会话到期{' '}
              {new Date(session.expiresAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              clearAdminSession();
              setSession(null);
            }}
          >
            退出登录
          </Button>
        </div>
        <AdminConsole session={session} />
      </div>
    </Layout>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: (s: AdminSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.adminLogin({ username, password });
      const next: AdminSession = { token: res.token, username: res.username, expiresAt: res.expiresAt };
      saveAdminSession(next);
      onSuccess(next);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'rate_limited'
          ? '尝试次数过多，请稍后再试'
          : '用户名或密码不正确',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-10">
      <Card className="w-full max-w-sm p-6">
        <h1 className="font-serif text-xl font-semibold tracking-wide text-ink">管理员登录</h1>
        <p className="mt-1 text-[13px] text-brown-muted">权限由服务端校验，前端隐藏按钮不构成任何保护。</p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-brown-soft">用户名</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full rounded-2xl border border-line bg-cream/70 px-4 py-3 text-base outline-none focus:border-orange"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-brown-soft">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-2xl border border-line bg-cream/70 px-4 py-3 text-base outline-none focus:border-orange"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-xl bg-[#fbeeed] px-3 py-2 text-[13px] text-[#8f4347]">
              {error}
            </p>
          ) : null}
          <Button type="submit" block size="lg" loading={busy}>
            登录
          </Button>
        </form>
      </Card>
    </div>
  );
}

function AdminConsole({ session }: { session: AdminSession }) {
  const [codes, setCodes] = useState<AdminCodeRow[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{ code: string; id: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, stat] = await Promise.all([
        api.adminListCodes(session.token),
        api.adminStats(session.token),
      ]);
      setCodes(list.codes);
      setStats(stat.stats);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unauthorized') {
        clearAdminSession();
        toast('管理员会话已过期，请重新登录', 'error');
      }
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleActive(row: AdminCodeRow) {
    try {
      await api.adminUpdateCode(session.token, { id: row.id, isActive: !row.isActive });
      toast(row.isActive ? '已停用' : '已启用', 'success');
      void refresh();
    } catch {
      toast('操作失败', 'error');
    }
  }

  async function bump(row: AdminCodeRow) {
    const next = Math.min(row.usedCount + 1, row.maxUses + 1);
    try {
      await api.adminUpdateCode(session.token, { id: row.id, maxUses: next });
      toast(`次数上限已改为 ${next}`, 'success');
      void refresh();
    } catch {
      toast('操作失败', 'error');
    }
  }

  if (loading) return <FullPageLoader label="正在读取数据…" />;

  return (
    <>
      {error ? (
        <Card>
          <ErrorState title="无法读取数据" body={error} onRetry={() => void refresh()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '密码总数', value: stats?.totalCodes ?? 0 },
              { label: '启用中', value: stats?.activeCodes ?? 0 },
              { label: '已完成测评', value: stats?.completedSessions ?? 0 },
              { label: '有效分享链接', value: stats?.liveShares ?? 0 },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-[12px] text-brown-muted">{s.label}</p>
                <p className="mt-1 font-serif text-2xl font-semibold text-ink">{s.value}</p>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <SectionTitle index="01" title="测试密码" hint="密码明文不会再次显示，只展示首尾提示。" />
          </div>

          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-line/70">
              {codes.length === 0 ? (
                <li className="px-5 py-10 text-center text-sm text-brown-muted">还没有创建任何测试密码</li>
              ) : (
                codes.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                    <div className="min-w-[8rem] flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[15px] tracking-[0.12em] text-ink">
                          {row.codeHint}
                        </span>
                        {row.isActive ? (
                          <Tag>启用中</Tag>
                        ) : (
                          <Tag tone="plain">已停用</Tag>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] text-brown-muted">
                        {row.label ?? '未命名'} · {row.usedCount}/{row.maxUses} 次已用 · 剩余{' '}
                        {row.remaining} 次
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void bump(row)}>
                        次数 +1
                      </Button>
                      <Button
                        size="sm"
                        variant={row.isActive ? 'ghost' : 'primary'}
                        onClick={() => void toggleActive(row)}
                      >
                        {row.isActive ? '停用' : '启用'}
                      </Button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <div className="flex justify-center pt-2">
            <Button size="lg" onClick={() => setCreateOpen(true)} data-testid="admin-create">
              新建测试密码
            </Button>
          </div>
        </>
      )}

      <CreateCodeDialog
        open={createOpen}
        token={session.token}
        onClose={() => setCreateOpen(false)}
        onCreated={(value) => {
          setCreated(value);
          void refresh();
        }}
      />

      <Dialog
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        title="新密码已创建"
        description="这是唯一一次显示完整密码，请立即复制并保存。"
      >
        <p className="select-all break-all rounded-2xl border border-line bg-cream px-4 py-4 text-center font-mono text-lg tracking-[0.2em] text-ink">
          {created?.code ?? ''}
        </p>
        <p className="mt-3 text-[13px] leading-[1.85] text-brown-soft">
          密码以 PBKDF2-SHA256 哈希形式存储，服务端不会保留也无法找回明文。默认额度为 3 次。
        </p>
      </Dialog>
    </>
  );
}

function CreateCodeDialog({
  open,
  onClose,
  token,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  onCreated: (v: { code: string; id: string }) => void;
}) {
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState(3);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.adminCreateCode(token, {
        label: label.trim() || undefined,
        maxUses,
        code: code.trim() || undefined,
      });
      onCreated({ code: res.plaintext, id: res.code.id });
      setLabel('');
      setCode('');
      setMaxUses(3);
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新建测试密码"
      description="留空则由服务端生成一个高强度随机密码。"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button className="flex-1" loading={busy} onClick={submit}>
            创建
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-brown-soft">备注名（可选）</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：小红书 10 月批次 A"
            className="w-full rounded-2xl border border-line bg-cream/70 px-4 py-3 text-base outline-none focus:border-orange"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-brown-soft">自定义密码（可选）</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="留空自动生成"
            autoComplete="off"
            className="w-full rounded-2xl border border-line bg-cream/70 px-4 py-3 font-mono tracking-[0.1em] outline-none focus:border-orange"
          />
          <p className="mt-1 text-[12px] text-brown-muted">至少 8 位，建议混合大小写、数字与符号。</p>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-brown-soft">可用次数</span>
          <input
            type="number"
            min={1}
            max={100}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
            className="w-full rounded-2xl border border-line bg-cream/70 px-4 py-3 text-base outline-none focus:border-orange"
          />
        </label>
      </div>
    </Dialog>
  );
}