#-- copyright
# OpenProject is a project management system.
# Copyright (C) 2012-2018 the OpenProject Foundation (OPF)
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2017 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# See docs/COPYRIGHT.rdoc for more details.
#++

require 'spec_helper'

describe Projects::UpdateService, 'integration', type: :model do
  let(:user) do
    FactoryBot.create(:user,
                      member_in_project: project,
                      member_through_role: role)
  end
  let(:role) do
    FactoryBot.create(:role,
                      permissions: permissions)
  end
  let(:permissions) do
    %i(edit_project)
  end

  let!(:project) { FactoryBot.create(:project, "custom_field_#{custom_field.id}" => 1) }
  let(:instance) { described_class.new(user: user, model: project) }
  let(:custom_field) { FactoryBot.create(:int_project_custom_field) }
  let(:attributes) { {} }
  let(:service_result) do
    instance
      .call(attributes)
  end

  describe '#call' do
    context 'if only a custom field is updated' do
      let(:attributes) do
        { "custom_field_#{custom_field.id}" => 8 }
      end

      it 'touches the project after saving' do
        former_updated_at = Project.pluck(:updated_on).first

        service_result

        later_updated_at = Project.pluck(:updated_on).first

        expect(former_updated_at)
          .not_to eql later_updated_at
      end
    end
  end
end
