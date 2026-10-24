import { Component } from 'react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/Toaster';
import { AccessPage } from '@/pages/AccessPage';
import { IntroPage } from '@/pages/IntroPage';
import { QuizPage } from '@/pages/QuizPage';
import { ResultPage } from '@/pages/ResultPage';
import { SharedResultPage } from '@/pages/SharedResultPage';
import { AdminPage } from '@/pages/AdminPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/States';
import { loadSession } from '@/lib/storage';

/**
 * HashRouter is used on purpose: GitHub Pages serves static files only and has
 * no rewrite rules, so every deep link must live in the URL fragment. That is
 * what makes a shared link work in any browser, on any device, forever.
 */

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RequireSession({ children }: { children: ReactNode }) {
  const session = loadSession();
  if (!session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[app] uncaught error', error);
  }

  render() {
    if (this.state.error) {
      return (
        <Layout>
          <Card className="my-10">
            <ErrorState title="页面出了点问题" body={this.state.error.message}>
              <Button variant="secondary" onClick={() => window.location.assign('#/')}>
                回到首页
              </Button>
            </ErrorState>
          </Card>
        </Layout>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <RootErrorBoundary>
      <HashRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<AccessPage />} />
          <Route
            path="/intro"
            element={
              <Layout>
                <IntroPage />
              </Layout>
            }
          />
          <Route
            path="/quiz"
            element={
              <RequireSession>
                <Layout>
                  <QuizPage />
                </Layout>
              </RequireSession>
            }
          />
          <Route
            path="/result/:sessionId"
            element={
              <Layout>
                <ResultPage />
              </Layout>
            }
          />
          <Route path="/s/:token" element={<SharedResultPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/start" element={<Navigate to="/" replace />} />
          <Route
            path="*"
            element={
              <Layout>
                <NotFoundPage />
              </Layout>
            }
          />
        </Routes>
        <Toaster />
      </HashRouter>
    </RootErrorBoundary>
  );
}