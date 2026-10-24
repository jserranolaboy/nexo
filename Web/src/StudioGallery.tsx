import { t as tr } from './i18n'
import { motion } from 'motion/react'
import { Plus, ArrowRight } from 'lucide-react'
import { newTemplate } from './domain'
import type { ID, Snapshot, Template } from './domain'
import { Empty, SceneHeading } from './ui'
export function StudioGallery({
  s,
  orgID,
  open,
}: {
  s: Snapshot
  orgID: ID
  open: (template: Template) => void
}) {
  const templates = s.templates.filter((t) => t.organizationID === orgID)
  return (
    <div className="scene studio-gallery">
      <SceneHeading title={tr('Plantillas')}>
        <button className="button primary" onClick={() => open(newTemplate(orgID))}>
          <Plus size={17} />
          {tr('Nueva plantilla')}
        </button>
      </SceneHeading>
      <div className="paper-gallery">
        {templates.map((template) => (
          <motion.button
            className="template-card"
            aria-label={template.name}
            key={template.id}
            onClick={() => open(template)}
            whileHover={{ y: -6, rotate: -0.7 }}
          >
            <div className="mini-paper" aria-hidden="true">
              {template.headerTitle && <strong>{template.headerTitle}</strong>}
              {template.backgroundPDFData && (
                <span className="original-pdf-tag">{tr('PDF original')}</span>
              )}
              <div
                className="mini-table"
                style={{ '--paper-accent': template.accentHex } as React.CSSProperties}
              >
                <div>
                  {template.columns.map((c) => (
                    <i key={c} />
                  ))}
                </div>
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i}>
                    {template.columns.map((c) => (
                      <i key={c} />
                    ))}
                  </div>
                ))}
              </div>
              {template.footerText && <small>{template.footerText}</small>}
            </div>
            <div className="template-caption">
              <h3>{template.name}</h3>
              <span>
                {template.columns.length} {tr('columnas')}
                <ArrowRight size={17} />
              </span>
            </div>
          </motion.button>
        ))}
        {!templates.length && <Empty title={tr('Sin plantillas')} />}
      </div>
    </div>
  )
}
