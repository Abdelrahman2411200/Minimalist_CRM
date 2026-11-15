import { Link } from 'react-router-dom';
import { appTitle } from '../title';
export function Brand({ to = '/contacts' }: { to?: string }) {
  return <Link className="brand" to={to}><span className="brand-mark" aria-hidden="true">m<span>.</span></span><span>{appTitle}<small>ROOM TO GROW.</small></span></Link>;
}
