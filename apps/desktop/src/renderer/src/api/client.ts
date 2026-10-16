import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const qk = {
  projects: ['projects'] as const,
  modules: (projectId: string) => ['modules', projectId] as const,
  cases: (projectId: string) => ['cases', projectId] as const,
  caseFile: (caseId: string) => ['case', caseId] as const,
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => window.atp.invoke('project:list') })
}

export function useModules(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.modules(projectId) : ['modules', 'none'],
    queryFn: () => window.atp.invoke('module:list', { projectId: projectId as string }),
    enabled: Boolean(projectId),
  })
}

export function useCases(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.cases(projectId) : ['cases', 'none'],
    queryFn: () => window.atp.invoke('case:list', { projectId: projectId as string }),
    enabled: Boolean(projectId),
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => window.atp.invoke('project:create', { name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projects }),
  })
}

export function useCreateModule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { projectId: string; parentId: string | null; name: string }) =>
      window.atp.invoke('module:create', input),
    onSuccess: (_row, vars) => void qc.invalidateQueries({ queryKey: qk.modules(vars.projectId) }),
  })
}

export function useCreateCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      projectId: string
      moduleId: string | null
      name: string
      startUrl: string
    }) => window.atp.invoke('case:create', input),
    onSuccess: (_row, vars) => void qc.invalidateQueries({ queryKey: qk.cases(vars.projectId) }),
  })
}

export function useDeleteNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (target: { kind: 'project' | 'module' | 'case'; id: string }) => {
      if (target.kind === 'project') return window.atp.invoke('project:delete', { id: target.id })
      if (target.kind === 'module') return window.atp.invoke('module:delete', { id: target.id })
      return window.atp.invoke('case:delete', { id: target.id })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projects })
      // 项目/用例联动键直接全刷（MVP 规模可接受）
      void qc.invalidateQueries()
    },
  })
}
