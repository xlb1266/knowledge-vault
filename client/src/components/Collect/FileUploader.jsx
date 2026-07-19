import { useRef } from 'react';

export default function FileUploader({ platform, onUpload, accept = '.json,.csv' }) {
  const fileRef = useRef(null);

  const handleChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    onUpload(file);
  };

  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📁</div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button className="btn btn-primary" onClick={() => fileRef.current.click()}>
        选择文件上传
      </button>
      <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
        支持 JSON (.json)、CSV (.csv) 格式
      </p>
    </div>
  );
}
