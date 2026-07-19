import ImportPanel from '../components/Collect/ImportPanel';
import { useEntries } from '../hooks/useEntries';

export default function ImportPage() {
  const { refresh } = useEntries();

  return (
    <div>
      <ImportPanel onImportComplete={refresh} />
    </div>
  );
}
