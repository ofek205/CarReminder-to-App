import { useLocation, useNavigate } from 'react-router-dom';
import useIsAdmin from '@/hooks/useIsAdmin';
import { Home, ArrowRight } from 'lucide-react';


export default function PageNotFound({}) {
    const location = useLocation();
    const navigate = useNavigate();
    const pageName = location.pathname.substring(1);
    // Server-side check (is_admin() RPC) — matches the rest of the codebase
    // (Layout's NavContent, every admin page). The previous inline check
    // read user.role from auth user_metadata, which the user can self-set
    // at signup; that gave any account the "admin hint" UI on the 404 page,
    // and was inconsistent with the documented source-of-truth.
    const isAdmin = useIsAdmin() === true;

    return (
        <div dir="rtl" className="min-h-[70vh] flex items-center justify-center p-6"
            style={{ background: '#FAFBFA' }}>
            <div className="max-w-md w-full text-center">
                {/* Friendly 404 */}
                <div className="text-8xl mb-4" role="img" aria-label="page not found">🔍</div>
                <h1 className="text-2xl font-black mb-2" style={{ color: '#1C2E20' }}>
                    העמוד לא נמצא
                </h1>
                <p className="text-sm mb-2" style={{ color: '#6B7280' }}>
                    לא הצלחנו למצוא את <span className="font-bold" style={{ color: '#2D5233' }}>"{pageName}"</span>.
                </p>
                <p className="text-xs mb-8" style={{ color: '#9CA3AF' }}>
                    ייתכן שהכתובת שגויה או שהעמוד הועבר.
                </p>

                {/* Admin hint */}
                {isAdmin && (
                    <div className="mb-6 p-3 rounded-xl text-right" style={{ background: '#FFF8E1', border: '1.5px solid #FDE68A' }}>
                        <p className="text-xs font-bold" style={{ color: '#92400E' }}>💡 הודעת מנהל</p>
                        <p className="text-[11px] mt-1" style={{ color: '#B45309' }}>
                            ייתכן שעמוד זה טרם מומש. בדוק את pages.config.js.
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-2.5">
                    <button
                        onClick={() => navigate('/Dashboard')}
                        className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                        style={{
                            background: 'linear-gradient(135deg, #2D5233 0%, #4B7A53 100%)',
                            color: '#fff',
                            boxShadow: '0 4px 16px rgba(45,82,51,0.25)',
                        }}>
                        <Home className="w-4 h-4" />
                        <span>חזרה לעמוד הבית</span>
                    </button>
                    <button
                        onClick={() => navigate(-1)}
                        className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                        style={{ background: '#fff', color: '#2D5233', border: '1.5px solid #D8E5D9' }}>
                        <ArrowRight className="w-4 h-4" />
                        <span>חזרה לעמוד הקודם</span>
                    </button>
                </div>
            </div>
        </div>
    );
}