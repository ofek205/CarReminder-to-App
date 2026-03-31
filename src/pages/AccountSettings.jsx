import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Users, UserPlus, Copy, Trash2, Crown, Shield, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { useAuth } from "../components/shared/GuestContext";

export default function AccountSettings() {
  const { isGuest } = useAuth();
  if (isGuest) {
    return (
      <div>
        <PageHeader title="חשבון משותף" />
        <Card className="p-8 border border-gray-100 shadow-sm rounded-2xl text-center space-y-4" dir="rtl">
          <div className="w-16 h-16 rounded-full bg-[#E8F2EA] flex items-center justify-center mx-auto">
            <Users className="h-8 w-8 text-[#2D5233]" />
          </div>
          <h2 className="font-semibold text-gray-900 text-lg">הירשם כדי לנהל חשבון משותף</h2>
          <p className="text-sm text-gray-500">שיתוף רכבים ומסמכים עם בני משפחה או שותפים זמין לאחר הרשמה.</p>
          <Button onClick={() => window.location.href = '/Auth'}
            className="gap-2 rounded-2xl font-bold" style={{ background: '#FFBF00', color: '#2D5233' }}>
            <UserPlus className="h-4 w-4" />
            הירשם בחינם
          </Button>
        </Card>
      </div>
    );
  }
  return <AuthAccountSettings />;
}

function AuthAccountSettings() {
  const [userId, setUserId] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState('חבר');
  const [inviteLink, setInviteLink] = useState('');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length > 0) {
        setAccountId(members[0].account_id);
        setMyRole(members[0].role);
      }
    }
    init();
  }, []);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['account-members', accountId],
    queryFn: async () => {
      return db.account_members.filter({ account_id: accountId, status: 'פעיל' });
    },
    enabled: !!accountId,
  });

  const { data: memberUsers = [] } = useQuery({
    queryKey: ['account-member-users', members.map(m => m.user_id).join(',')],
    queryFn: async () => {
      const userIds = members.map(m => m.user_id).filter(Boolean);
      if (userIds.length === 0) return [];
      // TODO: User entity not yet in Supabase — returning empty array
      // const users = await Promise.all(userIds.map(id => db.users.filter({ id })));
      // return users.flat();
      return [];
    },
    enabled: members.length > 0,
  });

  const canManage = myRole === 'בעלים' || myRole === 'מנהל';

  const createInvite = async () => {
    setCreating(true);
    // Use cryptographically secure random bytes instead of Math.random()
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const token = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    // TODO: Invite entity not yet in Supabase — create is a no-op for now
    // await db.invites.create({
    //   account_id: accountId,
    //   invited_by_user_id: userId,
    //   role_to_assign: inviteRole,
    //   token,
    //   expires_at: expires.toISOString(),
    //   max_uses: 1,
    //   uses_count: 0,
    //   status: 'פעיל',
    // });

    const link = `${window.location.origin}${window.location.pathname}#/JoinInvite?token=${token}`;
    setInviteLink(link);
    setCreating(false);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    toast.success('הלינק הועתק');
  };

  const removeMember = async (member) => {
    if (member.role === 'בעלים') return;
    await db.account_members.update(member.id, { status: 'הוסר' });
    queryClient.invalidateQueries({ queryKey: ['account-members'] });
  };

  const roleIcons = { 'בעלים': Crown, 'מנהל': Shield, 'חבר': User };
  const roleColors = { 'בעלים': 'text-amber-600', 'מנהל': 'text-blue-600', 'חבר': 'text-gray-500' };

  if (!accountId || isLoading) return <LoadingSpinner />;

  return (
    <div>
      <PageHeader
        title="חשבון משותף"
        subtitle={`${members.length} חברים`}
        actions={
          canManage && (
            <Button onClick={() => setShowInvite(true)} className="bg-amber-600 hover:bg-amber-700 text-white gap-2">
              <UserPlus className="h-4 w-4" />
              הזמן
            </Button>
          )
        }
      />

      <div className="space-y-3">
        {members.map(member => {
          const Icon = roleIcons[member.role] || User;
          const memberUser = memberUsers.find(u => u.id === member.user_id);
          return (
            <Card key={member.id} className="p-4 border border-gray-100">
              <div className="flex flex-row-reverse items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <Icon className={`h-5 w-5 ${roleColors[member.role]}`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{memberUser?.full_name || 'משתמש'}</p>
                    <p className="text-xs text-gray-400">{memberUser?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{member.role}</Badge>
                  {canManage && member.role !== 'בעלים' && member.user_id !== userId && (
                    <Button variant="ghost" size="icon" onClick={() => removeMember(member)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>הזמנת חבר</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>תפקיד</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="מנהל">מנהל</SelectItem>
                  <SelectItem value="חבר">חבר</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!inviteLink ? (
              <Button onClick={createInvite} disabled={creating} className="w-full bg-amber-600 hover:bg-amber-700 text-white">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'צור לינק הזמנה'}
              </Button>
            ) : (
              <div className="space-y-2">
                <Label>לינק הזמנה (תקף 7 ימים)</Label>
                <div className="flex gap-2">
                  <Input value={inviteLink} readOnly className="text-xs" dir="ltr" />
                  <Button onClick={copyLink} variant="outline" size="icon"><Copy className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}