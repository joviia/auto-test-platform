import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const qk = {
  projects: ['projects'] as const,
  modules: (projectId: string) => ['modules', projectId] as const,
  cases: (projectId: string) => ['cases', projectId] as const,
  caseFile: (caseId: string) => ['case', caseId] as const,
  suites: (projectId: string) => ['suites', projectId] as const,
  suite: (suiteId: string) => ['suite', suiteId] as const,
  plans: (projectId: string) => ['plans', projectId] as const,
  plan: (planId: string) => ['plan', planId] as const,
  planRuns: (planId: string) => ['planRuns', planId] as const,
  planRun: (planRunId: string) => ['planRun', planRunId] as const,
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

export function useSuites(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.suites(projectId) : ['suites', 'none'],
    queryFn: () => window.atp.invoke('suite:list', { projectId: projectId as string }),
    enabled: Boolean(projectId),
  })
}

export function useSuite(suiteId: string | null) {
  return useQuery({
    queryKey: suiteId ? qk.suite(suiteId) : ['suite', 'none'],
    queryFn: () => window.atp.invoke('suite:get', { id: suiteId as string }),
    enabled: Boolean(suiteId),
  })
}

export function usePlans(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.plans(projectId) : ['plans', 'none'],
    queryFn: () => window.atp.invoke('plan:list', { projectId: projectId as string }),
    enabled: Boolean(projectId),
  })
}

export function usePlan(planId: string | null) {
  return useQuery({
    queryKey: planId ? qk.plan(planId) : ['plan', 'none'],
    queryFn: () => window.atp.invoke('plan:get', { id: planId as string }),
    enabled: Boolean(planId),
  })
}

export function usePlanRuns(planId: string | null) {
  return useQuery({
    queryKey: planId ? qk.planRuns(planId) : ['planRuns', 'none'],
    queryFn: () => window.atp.invoke('plan:run-list', { planId: planId as string }),
    enabled: Boolean(planId),
  })
}

export function usePlanRun(planRunId: string | null) {
  return useQuery({
    queryKey: planRunId ? qk.planRun(planRunId) : ['planRun', 'none'],
    queryFn: () => window.atp.invoke('plan:run-get', { planRunId: planRunId as string }),
    enabled: Boolean(planRunId),
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
