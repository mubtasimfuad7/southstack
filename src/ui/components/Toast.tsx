import React from 'react'
import { CheckCircle, Info, AlertCircle, XCircle, X } from 'lucide-react'
import { useNotificationStore, type NotificationType } from '@/application/notificationStore'

const iconMap: Record<NotificationType, React.ReactNode> = {
  success: <CheckCircle className="text-green-400" size={18} />,
  info: <Info className="text-blue-400" size={18} />,
  warning: <AlertCircle className="text-yellow-400" size={18} />,
  error: <XCircle className="text-red-400" size={18} />,
}

const bgColorMap: Record<NotificationType, string> = {
  success: 'bg-green-500/10 border-green-500/20',
  info: 'bg-blue-500/10 border-blue-500/20',
  warning: 'bg-yellow-500/10 border-yellow-500/20',
  error: 'bg-red-500/10 border-red-500/20',
}

export function ToastContainer() {
  const { notifications, removeNotification } = useNotificationStore()

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`group flex items-start gap-3 min-w-[320px] max-w-[440px] p-4 rounded-xl border backdrop-blur-md shadow-2xl animate-in slide-in-from-right-8 fade-in duration-300 pointer-events-auto ${bgColorMap[n.type]}`}
        >
          <div className="mt-0.5 shrink-0">{iconMap[n.type]}</div>
          <div className="flex-1 text-sm text-text-primary leading-snug pr-2">
            {n.message}
          </div>
          <button
            onClick={() => removeNotification(n.id)}
            className="text-text-dim hover:text-text-primary p-0.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
