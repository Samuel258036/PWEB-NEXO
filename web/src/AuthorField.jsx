import { useId } from 'react'

export default function AuthorField({ label, value, onChange, multiline, readOnly, error, description }) {
  const id = useId()
  const props = {
    id,
    className: 'nexo-input nexo-author-input',
    value,
    readOnly,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || description ? id + '-description' : undefined,
    onChange: (event) => onChange?.(event.target.value),
  }
  return (
    <div className="nexo-author-field">
      <label className="nexo-label" htmlFor={id}>{label}</label>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} type="text" />}
      {(error || description) && (
        <p id={id + '-description'} className={error ? 'nexo-error' : 'nexo-warning'}>{error || description}</p>
      )}
    </div>
  )
}
