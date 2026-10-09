export const dashboard = {
  total: 'Total tasks',
  allTeams: (workspace: string) => `All teams in ${workspace}.`,
  yourTeams: (workspace: string) => `Your teams in ${workspace}.`,
  noTeams: 'There are no teams to show yet. Tasks appear here once you are in a team.',
  noTasks: 'No tasks yet. Open a team and create the first one.',
  upcoming: 'Upcoming deadlines',
  nothingDue: 'Nothing is due in this period.',
  team: 'Team',
};
