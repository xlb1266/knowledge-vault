import { useState, useEffect, useCallback } from 'react';
import { knowledgeApi } from '../api';

export function useEntries(initialParams = {}) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useState({ page: 1, pageSize: 20, ...initialParams });

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const result = await knowledgeApi.getEntries(params);
      setData(result);
    } catch (err) {
      console.error('获取条目失败:', err);
      setData({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const setPage = (page) => setParams((p) => ({ ...p, page }));
  const setFilter = (key, value) => setParams((p) => ({ ...p, [key]: value, page: 1 }));
  const refresh = fetchEntries;

  return { ...data, loading, setPage, setFilter, refresh, params };
}
