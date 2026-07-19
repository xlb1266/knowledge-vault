import Header from './Header';
import Sidebar from './Sidebar';

export default function Layout({ children, activeNav, onNavChange }) {
  return (
    <div className="app-layout">
      <Sidebar activeNav={activeNav} onNavChange={onNavChange} />
      <div className="main-content">
        <Header />
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
