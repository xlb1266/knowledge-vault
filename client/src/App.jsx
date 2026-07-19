import { useState } from 'react';
import Layout from './components/Layout/Layout';
import WikiPage from './pages/WikiPage';
import QaPage from './pages/QaPage';
import ImportPage from './pages/ImportPage';
import FilteredPage from './pages/FilteredPage';
import RulesPage from './pages/RulesPage';

export default function App() {
  const [activeNav, setActiveNav] = useState('wiki');
  // 问答助手引用跳转：点击引用卡片时，切到知识库并打开对应 wiki 页
  const [pendingWikiPath, setPendingWikiPath] = useState('');

  const handleNavChange = (nav) => {
    setActiveNav(nav);
  };

  const handleOpenWikiPage = (path) => {
    setPendingWikiPath(path);
    setActiveNav('wiki');
  };

  const renderPage = () => {
    switch (activeNav) {
      case 'wiki':
        return <WikiPage pendingWikiPath={pendingWikiPath} onConsumePending={() => setPendingWikiPath('')} />;
      case 'qa':
        return <QaPage onOpenWikiPage={handleOpenWikiPage} />;
      case 'import':
        return <ImportPage />;
      case 'filtered':
        return <FilteredPage />;
      case 'rules':
        return <RulesPage />;
      default:
        return <WikiPage pendingWikiPath={pendingWikiPath} onConsumePending={() => setPendingWikiPath('')} />;
    }
  };

  return (
    <Layout activeNav={activeNav} onNavChange={handleNavChange}>
      {renderPage()}
    </Layout>
  );
}
