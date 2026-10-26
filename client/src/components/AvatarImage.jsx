import { useState } from 'react';
import { requestAvatarRefresh, safeAvatarSrc } from '../utils/signedAvatar';

export default function AvatarImage({ src, alt = '', className, fallback = null, ...props }) {
  const [failedSource, setFailedSource] = useState('');
  const safeSrc = safeAvatarSrc(src);
  if (!safeSrc || safeSrc === failedSource) return fallback;
  return <img {...props} src={safeSrc} alt={alt} className={className} onError={() => {
    setFailedSource(safeSrc);
    requestAvatarRefresh(safeSrc);
  }} />;
}
