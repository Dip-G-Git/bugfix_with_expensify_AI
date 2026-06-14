'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['issue-stats'],
    queryFn: () => apiClient.get<{ totalNotified: number; todayCount: number }>('/api/issues/stats'),
  });

  const { data: issues, isLoading } = useQuery({
    queryKey: ['issues'],
    queryFn: () => apiClient.get<{ id: string; title: string; url: string; githubIssueNumber: number; labels: string[] }[]>('/api/issues'),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-500">Issues Notified Today</p>
          <p className="text-3xl font-bold text-gray-900">{stats?.todayCount ?? '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-500">Total Issues Tracked</p>
          <p className="text-3xl font-bold text-gray-900">{stats?.totalNotified ?? '—'}</p>
        </div>
      </div>

      {/* Issues list */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Recent Issues</h2>
        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {issues?.map((issue) => (
          <div key={issue.id} className="bg-white border border-gray-200 rounded-lg p-4">
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              #{issue.githubIssueNumber} {issue.title}
            </a>
            <div className="mt-2 flex gap-2 flex-wrap">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
