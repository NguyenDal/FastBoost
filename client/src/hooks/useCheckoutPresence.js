import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { leaveCheckoutPresence, renewCheckoutPresence } from '../api/orders';
import { checkoutPresenceController } from '../utils/checkoutPresence';

export default function useCheckoutPresence(orderId, { ready, onLost, onPaid }) {
    const [checkoutViewId, setCheckoutViewId] = useState(() => crypto.randomUUID());
    const controller = useMemo(() => checkoutPresenceController({ orderId, checkoutViewId,
        renew: renewCheckoutPresence, leave: leaveCheckoutPresence,
    }), [orderId, checkoutViewId]);
    useLayoutEffect(() => { controller.setCallbacks({
        onLost: failure => { setCheckoutViewId(crypto.randomUUID()); onLost(failure); }, onPaid,
    }); }, [controller, onLost, onPaid]);
    useLayoutEffect(() => { controller.setReady(ready); }, [controller, ready]);
    useEffect(() => controller.mount(), [controller]);
    return useMemo(() => ({ checkoutViewId, protect: controller.protect, clearProtection: controller.clearProtection, recover: controller.recover }), [checkoutViewId, controller]);
}
