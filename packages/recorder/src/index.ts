export {
  type BuildRecordedCaseOptions,
  buildRecordedCase,
  type RecordedCaseDraft,
} from './build-case.js'
export {
  collectorSource,
  type RawActionEvent,
  type RawLocatorCandidate,
  type RawPopupInfo,
  type RawProbeEvent,
  type RawRecorderEvent,
  type RawSemanticMeta,
  type RawTargetInfo,
} from './collector.js'
export { buildElement, elementIdOf, toLocatorCandidates } from './locator.js'
export { normalizeEvents, type RecorderStep } from './normalize.js'
export {
  buildSemanticDraft,
  displayText,
  type SemanticDraft,
  type SemanticEntry,
} from './semantic.js'
