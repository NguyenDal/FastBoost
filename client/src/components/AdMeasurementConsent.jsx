import { useId, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { googleAdsPurchase } from '../utils/googleAdsPurchase';
import '../styles/AdMeasurementConsent.css';

export default function AdMeasurementConsent({ disabled = false, compact = false }) {
    const consent = useSyncExternalStore(googleAdsPurchase.subscribe, googleAdsPurchase.getConsent, () => null);
    const descriptionId = useId();
    if (!googleAdsPurchase.enabled) return null;
    return <div className="ad-measurement-choice">
        <label className="ad-measurement-check-row">
            <input type="checkbox" className="ad-measurement-checkbox" name="adMeasurement"
                checked={consent === 'granted'} disabled={disabled} aria-describedby={compact ? undefined : descriptionId}
                onChange={event => googleAdsPurchase.setConsent(event.target.checked ? 'granted' : 'denied')} />
            <span>Allow advertising tools to measure activities on this website.</span>
        </label>
        {!compact && <p id={descriptionId} className="ad-measurement-description">
            Includes order value and an order ID. Applies immediately to this browser; change it in Account settings or our <Link to="/privacy-policy">Privacy policy</Link>.
        </p>}
    </div>;
}
