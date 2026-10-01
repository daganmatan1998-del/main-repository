import { useEffect } from 'react';
import { useUI } from './state/uiStore';
import { HomeScreen } from './ui/home/HomeScreen';
import { EditorScreen } from './ui/editor/EditorScreen';
import { Toasts } from './ui/common/Toasts';
import { ErrorBoundary } from './ui/common/ErrorBoundary';
import { requestPersistentStorage } from './persistence/db';

export default function App() {
  const route = useUI((s) => s.route);
  const navigate = useUI((s) => s.navigate);
  useEffect(() => {
    requestPersistentStorage();
    // Files dropped outside the viewport must not navigate the page away.
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
  return (
    <ErrorBoundary title="The application hit an error" resetLabel="Back to projects" onReset={() => navigate({ name: 'home' })}>
      {route.name === 'home' ? <HomeScreen /> : <EditorScreen key={route.projectId} projectId={route.projectId} />}
      <Toasts />
    </ErrorBoundary>
  );
}
