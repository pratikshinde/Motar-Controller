import React, { useState } from 'react';
import { Button, Divider, ListItemText, Menu, MenuItem } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useNavigate } from 'react-router-dom';
import { fetchManufacturersOverview, type ManufacturerSummary } from '../api/brands';
import { setViewing, useViewing } from '../api/viewing';

/**
 * Super admin only: jump to any manufacturer's dashboard (or back to the platform) from any page. The pages themselves do
 * not change: while a manufacturer is chosen they simply show that manufacturer's data (see api/viewing.ts).
 */
export const ManufacturerSwitcher: React.FC = () => {
  const navigate = useNavigate();
  const viewing = useViewing();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [list, setList] = useState<ManufacturerSummary[] | null>(null);

  async function open(e: React.MouseEvent<HTMLElement>) {
    setAnchor(e.currentTarget);
    try {
      setList((await fetchManufacturersOverview()).manufacturers);
    } catch {
      setList([]);
    }
  }

  function choose(m: ManufacturerSummary | null) {
    setAnchor(null);
    if (m) {
      setViewing({ key: m.key, name: m.name, color: m.primary_color });
      navigate('/fleet');
    } else {
      setViewing(null);
      navigate('/manufacturers');
    }
  }

  return (
    <>
      <Button color="inherit" startIcon={<BusinessIcon />} endIcon={<ArrowDropDownIcon />} onClick={open} sx={{ textTransform: 'none', maxWidth: 260 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewing ? viewing.name : 'All manufacturers'}</span>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem selected={!viewing} onClick={() => choose(null)}>
          <ListItemText primary="All manufacturers" secondary="The platform overview" />
        </MenuItem>
        <Divider />
        {list === null && <MenuItem disabled>Loading…</MenuItem>}
        {list?.map(m => (
          <MenuItem key={m.key} selected={viewing?.key === m.key} disabled={!m.owner} onClick={() => choose(m)}>
            <ListItemText primary={m.name} secondary={m.owner ? `${m.farmers} farmers · ${m.pumps.total} pumps` : 'No login yet'} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
