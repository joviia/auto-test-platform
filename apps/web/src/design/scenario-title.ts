import type { DesignScenario } from '@atp/model'

/**
 * 场景标题在列表里已按字段分组，个体标题去掉字段/范围前缀，避免重复。
 * 例：`内容名称-长度-合法边界` → `长度-合法边界`；`ATP Agent · 演示系统-正常流` → `正常流`。
 */
export function shortScenarioTitle(scenario: DesignScenario, scopeLabel?: string): string {
  const prefixes = [scenario.fieldLabel, scopeLabel]
  for (const raw of prefixes) {
    const label = raw?.trim()
    if (!label) continue
    for (const sep of [`${label}-`, `${label} - `, `${label} `]) {
      if (scenario.title.startsWith(sep)) {
        return scenario.title.slice(sep.length) || scenario.title
      }
    }
  }
  return scenario.title
}
