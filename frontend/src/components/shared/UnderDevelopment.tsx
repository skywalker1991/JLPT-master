import { Construction } from 'lucide-react'

interface Props {
  label: string
}

export default function UnderDevelopment({ label }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-fg-subtle">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Construction className="w-7 h-7 text-fg-subtle" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-semibold text-fg-muted">{label}</p>
        <p className="text-sm text-fg-subtle">开发中，敬请期待</p>
      </div>
    </div>
  )
}
