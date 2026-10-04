import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@shared/format-date'
import type { ProblemComment, ProblemDetail } from '@shared/modules'
import { NOT_AVAILABLE } from '@shared/problem-evidence'
import { useProblemComments } from '../data/modules'
import { dateLang } from '../lib/date-lang'
import { ApiWarnings, ModuleError } from './ModuleState'
import { BUTTON_SECONDARY } from './styles'

function Comment({ comment }: { comment: ProblemComment }): JSX.Element {
  const { i18n } = useTranslation()
  return (
    <li data-testid="problem-comment" className="grid gap-0.5 border-t border-border pt-1.5">
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{comment.author ?? NOT_AVAILABLE}</span>
        <span className="tabular-nums">
          {formatDateTime(comment.createdAt, dateLang(i18n.language))}
        </span>
        {comment.context !== null && (
          <span data-testid="comment-context" className="rounded bg-hover px-1.5">
            {comment.context}
          </span>
        )}
      </span>
      {/* Siempre como texto: un comentario nunca se interpreta como HTML. */}
      <span className="text-sm whitespace-pre-wrap">{comment.content}</span>
    </li>
  )
}

/**
 * Comentarios del problema: los recientes que trae el detalle y, si la API dice
 * que hay más (totalCount), un aviso y "Ver todos", que los pide con su propio
 * endpoint.
 */
export function CommentsSection({
  envId,
  detail
}: {
  envId: string
  detail: ProblemDetail
}): JSX.Element {
  const { t } = useTranslation()
  const [wantAll, setWantAll] = useState(false)
  const all = useProblemComments(envId, detail.problemId, wantAll)
  const total = detail.commentTotal
  // Contra lo que mandó la API: un comentario ilegible no significa que haya más.
  const more = total !== null && total > detail.commentReceived
  const comments = all.data?.comments ?? detail.comments

  return (
    <div className="grid gap-2">
      {more && all.data === undefined && (
        <p
          data-testid="comments-api-truncated"
          role="status"
          className="text-xs text-muted-foreground"
        >
          {t('problems.recentComments', { shown: detail.comments.length, total })}
        </p>
      )}
      <ul className="grid gap-1.5">
        {comments.map((comment, index) => (
          <Comment key={index} comment={comment} />
        ))}
      </ul>
      {all.data?.truncated === true && (
        <p
          data-testid="comments-all-truncated"
          role="status"
          className="text-xs text-status-warning"
        >
          {t('problems.apiTruncatedComments', {
            shown: all.data.comments.length,
            total: all.data.totalCount ?? all.data.comments.length
          })}
        </p>
      )}
      <ApiWarnings invalid={all.data?.invalid} />
      {all.error !== null && <ModuleError error={all.error} />}
      {more && all.data === undefined && (
        <button
          type="button"
          data-testid="comments-show-all"
          disabled={all.isFetching}
          onClick={() => setWantAll(true)}
          className={`${BUTTON_SECONDARY} justify-self-start`}
        >
          {all.isFetching ? t('module.loading') : t('problems.showAllComments', { count: total })}
        </button>
      )}
    </div>
  )
}
