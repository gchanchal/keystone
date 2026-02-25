import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Mail,
  Trash2,
  Loader2,
  Check,
  Clock,
  Shield,
  Edit2,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { personalTeamApi } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

interface TeamMember {
  id: string;
  ownerUserId: string;
  memberEmail: string;
  memberUserId: string | null;
  role: 'viewer' | 'editor' | 'admin';
  invitedAt: string;
  acceptedAt: string | null;
  isActive: boolean;
}

const ROLE_ICONS = {
  viewer: Eye,
  editor: Edit2,
  admin: Shield,
};

const ROLE_LABELS = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
};

const ROLE_DESCRIPTIONS = {
  viewer: 'Can view your personal financial data',
  editor: 'Can view and edit your personal data',
  admin: 'Full access including sharing management',
};

export function PersonalTeamManagement() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);

  // Fetch team members
  const { data: members = [], isLoading, error } = useQuery<TeamMember[]>({
    queryKey: ['personal-team-members'],
    queryFn: () => personalTeamApi.getMembers(),
  });

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: 'viewer' | 'editor' | 'admin' }) =>
      personalTeamApi.invite(email, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-team-members'] });
      setInviteEmail('');
      setInviteRole('viewer');
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'viewer' | 'editor' | 'admin' }) =>
      personalTeamApi.updateRole(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-team-members'] });
    },
  });

  // Remove mutation
  const removeMutation = useMutation({
    mutationFn: (id: string) => personalTeamApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-team-members'] });
      setMemberToRemove(null);
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-red-500">Failed to load shared access members.</p>
        </CardContent>
      </Card>
    );
  }

  const activeMembers = members.filter(m => m.isActive);

  return (
    <div className="space-y-6">
      {/* Invite Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite Someone
          </CardTitle>
          <CardDescription>
            Invite users to view or manage your personal financial data. They will be able to see your accounts, transactions, and investments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                type="email"
                placeholder="Enter email address..."
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteMutation.isPending}
              />
            </div>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as any)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Viewer
                  </div>
                </SelectItem>
                <SelectItem value="editor">
                  <div className="flex items-center gap-2">
                    <Edit2 className="h-4 w-4" />
                    Editor
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Admin
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!inviteEmail.trim() || inviteMutation.isPending}>
              {inviteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              Invite
            </Button>
          </form>
          {inviteMutation.isError && (
            <p className="text-sm text-red-500 mt-2">
              {(inviteMutation.error as any)?.response?.data?.error || 'Failed to send invite'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Shared With
            {activeMembers.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeMembers.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeMembers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No one has access yet</p>
              <p className="text-sm">Invite someone to share access to your personal finances</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeMembers.map((member) => {
                const RoleIcon = ROLE_ICONS[member.role];
                const isAccepted = !!member.acceptedAt;

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Mail className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{member.memberEmail}</span>
                          {isAccepted ? (
                            <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                              <Check className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                              <Clock className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Invited {formatDistanceToNow(new Date(member.invitedAt), { addSuffix: true })}
                          {isAccepted && member.acceptedAt && (
                            <span className="ml-2">
                              | Joined {formatDistanceToNow(new Date(member.acceptedAt), { addSuffix: true })}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Select
                        value={member.role}
                        onValueChange={(value) =>
                          updateRoleMutation.mutate({ id: member.id, role: value as any })
                        }
                        disabled={updateRoleMutation.isPending}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">
                            <div className="flex items-center gap-2">
                              <Eye className="h-4 w-4" />
                              Viewer
                            </div>
                          </SelectItem>
                          <SelectItem value="editor">
                            <div className="flex items-center gap-2">
                              <Edit2 className="h-4 w-4" />
                              Editor
                            </div>
                          </SelectItem>
                          <SelectItem value="admin">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4" />
                              Admin
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setMemberToRemove(member)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role Descriptions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {(['viewer', 'editor', 'admin'] as const).map((role) => {
              const RoleIcon = ROLE_ICONS[role];
              return (
                <div key={role} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <RoleIcon className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">{ROLE_LABELS[role]}</p>
                    <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Remove Confirmation Dialog */}
      <Dialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Access</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{memberToRemove?.memberEmail}</strong>?
              They will lose access to your personal financial data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberToRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => memberToRemove && removeMutation.mutate(memberToRemove.id)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
