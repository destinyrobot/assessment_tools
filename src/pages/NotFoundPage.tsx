import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { BRAND } from '@/config/brand';
import { ArcDecor } from '@/components/Brand';

export function NotFoundPage() {
  return (
    <Layout>
      <div className="relative py-16">
        <ArcDecor className="pointer-events-none absolute -right-20 top-0 size-[280px] text-orange/20" />
        <Card className="relative">
          <ErrorState
            title="这个页面不存在"
            body={`可能是链接输错了，或者分享已经被撤销。回到首页输入密码就可以开始${BRAND.shortName}。`}
          >
            <Link to="/">
              <Button data-testid="notfound-home">回到首页</Button>
            </Link>
          </ErrorState>
        </Card>
      </div>
    </Layout>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '未知错误';

  return (
    <Layout>
      <Card className="my-10">
        <ErrorState title="页面出了点问题" body={message}>
          <a href="./">
            <Button variant="secondary">回到首页</Button>
          </a>
        </ErrorState>
      </Card>
    </Layout>
  );
}