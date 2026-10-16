import type { ReactNode } from 'react'

export function ThreeColumn(props: { left: ReactNode; center: ReactNode; right: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-default-200 bg-content1">
        {props.left}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{props.center}</main>
      <aside className="flex w-96 shrink-0 flex-col border-l border-default-200 bg-content1">
        {props.right}
      </aside>
    </div>
  )
}
