import { useNavigate } from 'react-router-dom';
import { BRAND } from '@/config/brand';
import { Button } from '@/components/ui/Button';
import { BulletList, Card, SectionTitle, Tag } from '@/components/ui/Card';
import { loadSession } from '@/lib/storage';
import { SCORING_VERSION } from '@shared/dimensions.ts';
import { QUESTIONS } from '@shared/questions.ts';
import { ARCHETYPE_ORDER, ARCHETYPES } from '@shared/archetypes.ts';

const HIGHLIGHTS = [
  {
    title: '24 道原创题目',
    body: '覆盖决策方式、风险偏好、独立与协作、创造力与执行力、压力应对、职业价值观、沟通与冲突、亲密关系需求八个维度。',
  },
  {
    title: '8 种原创性格原型',
    body: '不是简单贴标签。报告会结合你的具体分数，生成属于你的职业方向、工作环境、人际风格与关系建议。',
  },
  {
    title: '可保存可分享',
    body: '生成一张竖版结果长图，附一个跨设备可访问的公开链接，随时发到朋友圈或小红书。',
  },
];

export function IntroPage() {
  const navigate = useNavigate();
  const session = loadSession();

  return (
    <div className="animate-rise space-y-6 py-6 sm:py-10">
      <header className="relative overflow-hidden rounded-card border border-line bg-gradient-to-br from-orange-wash via-card to-cream-deep p-6 sm:p-9">
        <div className="relative">
          <Tag>{BRAND.theme}</Tag>
          <h1 className="mt-4 text-balance font-serif text-[26px] font-semibold leading-[1.35] tracking-wide text-ink sm:text-[32px]">
            {BRAND.subline}
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-[1.9] text-brown-soft">
            我们常用别人的标准来衡量自己：什么时候该稳定，什么时候该折腾，和谁在一起才算合适。
            24 道题会帮你把这些模糊的直觉，变成一张可以拿出去看的图。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => navigate('/quiz')} disabled={!session}>
              {session?.remaining ? `开始作答（还剩 ${session.remaining} 次额度）` : '开始作答'}
            </Button>
            {!session ? (
              <Button variant="ghost" onClick={() => navigate('/')}>
                返回输入密码
              </Button>
            ) : null}
          </div>
          <p className="mt-3 text-[12px] text-brown-muted">
            预计用时 5–8 分钟 · 评分版本 {SCORING_VERSION} · 共 {QUESTIONS.length} 题
          </p>
        </div>
      </header>

      <section className="space-y-4">
        <SectionTitle index="01" title="你会得到什么" />
        <div className="grid gap-4 sm:grid-cols-3">
          {HIGHLIGHTS.map((item, i) => (
            <Card key={item.title} className="p-5">
              <span className="font-mono text-[11px] tracking-[0.2em] text-orange">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 font-serif text-[16px] font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-[13.5px] leading-[1.8] text-brown-soft">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle index="02" title="8 种性格原型" hint="结果由你的八个维度得分共同决定，同一种原型里的人也各有不同。" />
        <Card className="p-5 sm:p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {ARCHETYPE_ORDER.map((id) => {
              const a = ARCHETYPES[id];
              return (
                <li
                  key={id}
                  className="flex items-start gap-3 rounded-2xl border border-line/70 bg-cream/50 p-3.5"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-xl font-serif text-[15px] font-semibold text-white"
                    style={{ backgroundColor: a.palette.accent }}
                    aria-hidden
                  >
                    {a.glyph}
                  </span>
                  <div className="min-w-0">
                    <p className="font-serif text-[15px] font-semibold text-ink">{a.name}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-brown-muted">{a.tagline}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionTitle index="03" title="开始之前" />
        <Card className="p-5 sm:p-6">
          <BulletList
            marker="num"
            items={[
              '请按第一反应作答，反复修改会降低结果的参考价值。',
              '中途可以返回上一题修改答案，也可以关闭页面再回来继续（同一轮不重复扣次数）。',
              '全部题目完成后才会提交并出结果。',
              '本测评是娱乐与自我探索参考，不构成心理诊断、职业建议或任何医疗意见。',
            ]}
          />
          <div className="mt-6">
            <Button size="lg" block onClick={() => navigate('/quiz')} disabled={!session}>
              我准备好了
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}